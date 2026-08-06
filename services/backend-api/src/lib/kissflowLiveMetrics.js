'use strict';

const { getPool } = require('./db');
const { buildEngagementTotals, APP_ENGAGEMENT_QUERY } = require('./engagementSummary');
const { isLoggedInToday } = require('./reportTimezone');
const {
  resolveKissflowCredentials,
  fetchKissflowUserDetail,
  fetchAllProcessItems,
  pickString,
  normalizeProcessStatus,
} = require('./kissflowClient');
const { saveEngagementCache } = require('./engagementCache');

const APP_MEMBER_QUERY = `
SELECT DISTINCT user_id
FROM (
  SELECT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
  UNION
  SELECT ia.principal_id AS user_id
  FROM engagement_reporting.item_assignment ia
  WHERE ia.environment = $1
    AND (ia.application_id = $2 OR ia.process_id = ANY($3::text[]))
    AND ia.principal_type = 'USER'
  UNION
  SELECT pu.user_id
  FROM engagement_reporting.item_assignment ia
  INNER JOIN engagement_reporting.principal_user pu
    ON pu.environment = ia.environment
   AND pu.application_id = $2
   AND pu.principal_id = ia.principal_id
   AND pu.principal_type = ia.principal_type
   AND pu.valid_to IS NULL
  WHERE ia.environment = $1
    AND ia.principal_type = 'APP_ROLE'
    AND (ia.application_id = $2 OR ia.process_id = ANY($3::text[]))
) members
WHERE user_id IS NOT NULL
`;

function kissflowDateValue(raw, keys) {
  for (const key of keys) {
    const val = raw?.[key];
    if (val == null) continue;
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (typeof val === 'object' && typeof val.v === 'string' && val.v.trim()) return val.v.trim();
  }
  return null;
}

function normalizeUserRow(raw) {
  const lastSignIn = kissflowDateValue(raw, [
    'LastLoggedInAt',
    'Last_Signin',
    'LastSignIn',
    'last_sign_in',
    'LastLogin',
    'Last_Login',
  ]);
  const everLoggedIn = Boolean(
    raw?.LastLoggedInAt != null ||
      raw?.Ever_Logged_In === true ||
      raw?.ever_logged_in === true ||
      String(raw?.Ever_Logged_In || raw?.ever_logged_in || '').toLowerCase() === 'true' ||
      lastSignIn,
  );
  return {
    user_id: pickString(raw, ['_id', 'Id', 'id', 'UserId']),
    user_name: pickString(raw, ['Name', 'name', 'UserName', 'DisplayName']),
    email: pickString(raw, ['Email', 'email', 'MailId']),
    last_sign_in: lastSignIn,
    ever_logged_in: everLoggedIn,
    open_count: 0,
    completed_count: 0,
    assigned: 0,
    has_app_role: false,
  };
}

function countTicketStatuses(items) {
  let open = 0;
  let closed = 0;
  for (const raw of items) {
    const status = normalizeProcessStatus(raw);
    if (status === 'InProgress') open += 1;
    if (status === 'Completed') closed += 1;
  }
  return { open, closed };
}

function pushUserId(set, value) {
  if (!value) return;
  if (typeof value === 'string' && value.trim()) {
    set.add(value.trim());
    return;
  }
  if (typeof value === 'object') {
    const id = value._id || value.Id || value.id || value.UserId;
    if (typeof id === 'string' && id.trim()) set.add(id.trim());
  }
}

/** Collect assignee / requester ids from process items — related users only. */
function collectRelatedUserIdsFromItems(items) {
  const ids = new Set();
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    pushUserId(ids, item.Assigned_To);
    pushUserId(ids, item.Assignee);
    pushUserId(ids, item.assigned_to);
    pushUserId(ids, item.Requester);
    pushUserId(ids, item.Requested_By);
    pushUserId(ids, item.Employee);
    pushUserId(ids, item.Employee_Name);
    pushUserId(ids, item._created_by);
    pushUserId(ids, item._modified_by);
    pushUserId(ids, item._submitted_by);
    // Common nested activity actor
    if (Array.isArray(item._activity_instance)) {
      for (const act of item._activity_instance) {
        pushUserId(ids, act?._created_by);
        pushUserId(ids, act?.Assigned_To);
      }
    }
  }
  return ids;
}

function applyItemCountsToUsers(userRows, items) {
  const byUser = new Map(userRows.map((u) => [u.user_id, { ...u }]));
  for (const item of items || []) {
    const status = normalizeProcessStatus(item);
    const assigneeIds = new Set();
    pushUserId(assigneeIds, item.Assigned_To);
    pushUserId(assigneeIds, item.Assignee);
    pushUserId(assigneeIds, item.assigned_to);
    // fall back to creator for completed attribution
    if (!assigneeIds.size) {
      pushUserId(assigneeIds, item._created_by);
    }
    for (const userId of assigneeIds) {
      const row = byUser.get(userId);
      if (!row) continue;
      row.assigned = (row.assigned || 0) + 1;
      if (status === 'InProgress') row.open_count = (row.open_count || 0) + 1;
      if (status === 'Completed') row.completed_count = (row.completed_count || 0) + 1;
    }
  }
  return [...byUser.values()];
}

async function fetchRelatedUserDetails({
  environment,
  accountId,
  userIds,
  credentials,
  concurrency = 8,
}) {
  const ids = [...userIds].filter(Boolean);
  const out = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const batch = await Promise.all(
      chunk.map(async (userId) => {
        try {
          const detail = await fetchKissflowUserDetail({
            environment,
            accountId,
            userId,
            credentials,
          });
          return { _id: userId, ...(detail && typeof detail === 'object' ? detail : {}) };
        } catch {
          return { _id: userId };
        }
      }),
    );
    out.push(...batch);
  }
  return out;
}

async function fetchLiveAppMetrics(environment, applicationId, { persistCache = true } = {}) {
  const pool = getPool();
  const appResult = await pool.query(
    `SELECT
       a.application_name,
       a.source_payload,
       acc.kissflow_account_id AS account_kissflow_id
     FROM engagement_reporting.application a
     LEFT JOIN engagement_reporting.account acc
       ON acc.account_id = NULLIF(a.source_payload->>'account_id', '')::uuid
     WHERE a.environment = $1 AND a.application_id = $2 AND a.is_current = true
     LIMIT 1`,
    [environment, applicationId],
  );
  if (!appResult.rows.length) {
    const err = new Error('Application not found');
    err.code = 'APPLICATION_NOT_FOUND';
    throw err;
  }
  const appRow = appResult.rows[0];
  const payload = appRow.source_payload || {};
  const accountId =
    payload.kissflow_account_id ||
    appRow.account_kissflow_id ||
    (environment === 'production' ? 'AcCMptlq60zH' : null);
  if (!accountId) {
    const err = new Error('kissflow_account_id missing on application');
    err.code = 'KISSFLOW_ACCOUNT_MISSING';
    throw err;
  }

  const processResult = await pool.query(
    `SELECT process_id FROM engagement_reporting.process
     WHERE environment = $1 AND application_id = $2 AND is_current = true
     ORDER BY process_name`,
    [environment, applicationId],
  );
  const processIds = processResult.rows.map((r) => r.process_id).filter(Boolean);
  if (!processIds.length) {
    const err = new Error('No processes registered for application');
    err.code = 'PROCESS_NOT_FOUND';
    throw err;
  }

  const credentials = await resolveKissflowCredentials(environment);

  // 1) Items first — needed for related users + ticket totals (no full account user dump).
  let allItems = [];
  let openTickets = 0;
  let closedTickets = 0;
  for (const processId of processIds) {
    const items = await fetchAllProcessItems({
      environment,
      accountId,
      processId,
      credentials,
    });
    allItems = allItems.concat(items);
    const counts = countTicketStatuses(items);
    openTickets += counts.open;
    closedTickets += counts.closed;
  }

  const itemUserIds = collectRelatedUserIdsFromItems(allItems);

  const memberResult = await pool.query(APP_MEMBER_QUERY, [environment, applicationId, processIds]);
  let memberIds = new Set(memberResult.rows.map((r) => r.user_id).filter(Boolean));
  const snapshotMembers = await pool.query(APP_ENGAGEMENT_QUERY, [environment, applicationId]);
  const snapshotByUser = new Map(snapshotMembers.rows.map((row) => [row.user_id, row]));
  if (!memberIds.size) {
    memberIds = new Set(snapshotMembers.rows.map((r) => r.user_id).filter(Boolean));
  }

  const relatedIds = new Set([...memberIds, ...itemUserIds]);

  // Related users only — never pull the full Kissflow directory for engagement.
  const rawUsers = relatedIds.size
    ? await fetchRelatedUserDetails({
        environment,
        accountId,
        userIds: relatedIds,
        credentials,
      })
    : [];

  let userRows = rawUsers.map(normalizeUserRow).filter((u) => u.user_id);
  userRows = userRows.map((row) => {
    const snap = snapshotByUser.get(row.user_id);
    if (!snap) return row;
    const lastSignIn = row.last_sign_in || snap.last_sign_in || null;
    return {
      ...row,
      last_sign_in: lastSignIn,
      ever_logged_in: row.ever_logged_in || snap.ever_logged_in || Boolean(lastSignIn),
      has_app_role: Boolean(snap.has_app_role) || row.has_app_role,
    };
  });
  userRows = applyItemCountsToUsers(userRows, allItems);

  const totals = buildEngagementTotals(userRows);
  totals.open_tickets = openTickets;
  totals.closed_tickets = closedTickets;

  const fetchedAt = new Date().toISOString();
  const result = {
    application_id: applicationId,
    application_name: appRow.application_name,
    snapshot_at: fetchedAt,
    fetched_at: fetchedAt,
    data_source: 'live',
    users: userRows,
    metrics: {
      total_users: totals.total_users,
      sign_in_today: totals.active_today,
      sign_in_rate_overall: totals.sign_in_rate_overall,
      sign_in_rate_today: totals.sign_in_rate_today,
      open_tickets: totals.open_tickets,
      closed_tickets: totals.closed_tickets,
    },
    live_user_count: userRows.length,
    related_user_count: relatedIds.size,
    item_count: allItems.length,
    sign_in_today_basis: 'Asia/Kolkata',
  };

  if (persistCache) {
    const items = userRows.map((row) => ({
      user_id: row.user_id,
      user_name: row.user_name,
      email: row.email,
      user_type: null,
      active_status: null,
      last_sign_in: row.last_sign_in,
      ever_logged_in: row.ever_logged_in,
      assigned: row.assigned || 0,
      open: row.open_count || 0,
      completed: row.completed_count || 0,
      rejected: 0,
      role_names: [],
      has_assignment: (row.assigned || 0) > 0,
      has_app_role: Boolean(row.has_app_role),
      source_payload: {},
    }));
    await saveEngagementCache(pool, {
      environment,
      applicationId,
      payload: {
        fetched_at: fetchedAt,
        snapshot_at: fetchedAt,
        data_source: 'live',
        items,
        totals: {
          total_users: items.length,
          active_today: items.filter((r) => isLoggedInToday(r.last_sign_in)).length,
          inactive: items.filter((r) => r.last_sign_in && !isLoggedInToday(r.last_sign_in)).length,
          never_logged_in: items.filter((r) => !r.ever_logged_in && !r.last_sign_in).length,
          total_assigned: items.reduce((sum, r) => sum + Number(r.assigned || 0), 0),
          with_assignments: items.filter((r) => Number(r.assigned || 0) > 0).length,
          with_app_role: items.filter((r) => r.has_app_role).length,
          open_tickets: openTickets,
          closed_tickets: closedTickets,
        },
      },
    });
  }

  return result;
}

module.exports = {
  fetchLiveAppMetrics,
  isLoggedInToday,
  collectRelatedUserIdsFromItems,
};
