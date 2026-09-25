'use strict';

const { getPool } = require('./db');
const { buildEngagementTotals, APP_ENGAGEMENT_QUERY, loadItemTodayCounts } = require('./engagementSummary');
const { isLoggedInToday, isSameCalendarDay } = require('./reportTimezone');
const {
  resolveKissflowCredentials,
  fetchKissflowUserDetail,
  fetchAllProcessItems,
  pickString,
  pickDateTime,
  normalizeProcessStatus,
  isItsmBusinessClosed,
  isItsmBusinessOpen,
} = require('./kissflowClient');
const { saveEngagementCache } = require('./engagementCache');
const { buildLiveRecordRows, enrichRecordsWithAssigneeCompany, isDraftRaw, isPmApp, isItsmApp, buildPmPortfolioFromRecords } = require('./appRecords');
const { classifyTicketSource, resolvePersonDisplayName, filterDisplayablePeople, friendlyApplicationName } = require('./dashboardDisplay');
const { isP2pApplication, loadP2pDashboard } = require('./p2pDashboard');

const ITSM_APP_ID = 'IT_Service_Management_A00';

/**
 * P2P is MySQL-only — never call Kissflow Admin Get-all-items (403 without Admin keys).
 */
async function fetchLiveP2pMetrics(environment, applicationId, { persistCache = true } = {}) {
  const pool = getPool();
  const p2p = await loadP2pDashboard({ environment, period: 'all', entity: 'all' });
  const m = p2p?.metrics || {};
  const open = Number(m.open ?? m.pending ?? 0);
  const closed = Number(m.closed ?? m.completed ?? 0);
  const rejected = Number(m.rejected || 0);
  const totalUsers = Number(m.total_users || 0);
  const signInToday = Number(m.signed_in_today || 0);
  const fetchedAt = p2p?.snapshot_at || new Date().toISOString();
  const users = Array.isArray(p2p?.users)
    ? p2p.users.map((u) => ({
        user_id: String(u.user_id || u.user_name || '').trim() || null,
        user_name: u.user_name || null,
        email: u.email || null,
        last_sign_in: u.last_sign_in || null,
        ever_logged_in: Boolean(u.last_sign_in),
        open_count: Number(u.open ?? u.pending ?? 0),
        completed_count: Number(u.closed ?? u.completed ?? 0),
        rejected_count: Number(u.rejected || 0),
        assigned: Number(u.total || 0),
        has_app_role: true,
      })).filter((u) => u.user_id || u.user_name)
    : [];

  const result = {
    application_id: applicationId,
    application_name: p2p?.application_name || 'Procurement to Pay',
    snapshot_at: fetchedAt,
    fetched_at: fetchedAt,
    data_source: p2p?.data_source || 'p2p_mysql_readonly',
    users,
    metrics: {
      total_users: totalUsers,
      sign_in_today: signInToday,
      sign_in_rate_overall: Number(m.sign_in_rate_overall || 0),
      sign_in_rate_today: Number(m.sign_in_rate_today || 0),
      open_tickets: open,
      closed_tickets: closed,
      opened_today: 0,
      closed_today: 0,
    },
    live_user_count: users.length,
    related_user_count: users.length,
    item_count: Number(m.total || open + closed + rejected),
    sign_in_today_basis: 'Asia/Kolkata',
  };

  if (persistCache) {
    const items = users.map((row) => ({
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
      rejected: row.rejected_count || 0,
      role_names: [],
      has_assignment: (row.assigned || 0) > 0,
      has_app_role: true,
      source_payload: {},
    }));
    await saveEngagementCache(pool, {
      environment,
      applicationId,
      payload: {
        fetched_at: fetchedAt,
        snapshot_at: fetchedAt,
        data_source: 'p2p_mysql_readonly',
        items,
        records: [],
        totals: {
          total_users: totalUsers || items.length,
          active_today: signInToday,
          never_logged_in: Math.max(0, (totalUsers || items.length) - signInToday),
          open_tickets: open,
          closed_tickets: closed,
          rejected_tickets: rejected,
          opened_today: 0,
          closed_today: 0,
        },
      },
    });
  }

  return result;
}

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

function normalizeCompanyKeyFromRaw(raw) {
  const company = pickString(raw, ['Company', 'company', 'Department', 'Dept', 'Employee_entity', 'Organization']);
  const hay = company.toLowerCase();
  if (hay.includes('extrovis')) return 'extrovis';
  if (hay.includes('refex')) return 'refex';
  return company ? 'refex' : '';
}

function isUserActiveFromRaw(raw) {
  if (raw?.IsActive === false) return false;
  if (String(raw?.IsActive || '').toLowerCase() === 'false') return false;
  const status = pickString(raw, ['Status', 'status']);
  if (status && /inactive|disabled|deactiv/i.test(status)) return false;
  return true;
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
  const isActive = isUserActiveFromRaw(raw);
  const company = pickString(raw, ['Company', 'company', 'Department', 'Dept', 'Employee_entity']);
  return {
    user_id: pickString(raw, ['_id', 'Id', 'id', 'UserId']),
    user_name: pickString(raw, ['Name', 'name', 'UserName', 'DisplayName']),
    email: pickString(raw, ['Email', 'email', 'MailId']),
    company,
    company_key: normalizeCompanyKeyFromRaw(raw),
    is_active: isActive,
    active_status: isActive ? 'Active' : 'Inactive',
    last_sign_in: lastSignIn,
    ever_logged_in: everLoggedIn,
    open_count: 0,
    completed_count: 0,
    assigned: 0,
    has_app_role: false,
  };
}

function isRejectedStatus(raw) {
  const status = String(raw?._status || raw?.Status || raw?.process_status || '').toLowerCase();
  const norm = normalizeProcessStatus(raw);
  return (
    norm === 'Withdrawn' ||
    status.includes('reject') ||
    status.includes('cancel') ||
    status.includes('withdraw')
  );
}

function countTicketStatuses(items, { applicationId } = {}) {
  const itsm = applicationId === ITSM_APP_ID;
  let open = 0;
  let closed = 0;
  let rejected = 0;
  for (const raw of items) {
    if (isDraftRaw(raw)) continue;
    if (isRejectedStatus(raw)) {
      rejected += 1;
      continue;
    }
    if (itsm) {
      if (isItsmBusinessOpen(raw)) open += 1;
      else if (isItsmBusinessClosed(raw)) closed += 1;
      continue;
    }
    const status = normalizeProcessStatus(raw);
    if (status === 'InProgress') open += 1;
    else if (status === 'Completed' || status === 'Closed') closed += 1;
  }
  return { open, closed, rejected };
}

function countTicketSources(items) {
  const buckets = { Email: 0, WhatsApp: 0, Mobile: 0, Web: 0, Other: 0 };
  for (const raw of items || []) {
    const ch = classifyTicketSource(raw || {});
    buckets[ch] = (buckets[ch] || 0) + 1;
  }
  return buckets;
}

function itemCreatedAt(raw) {
  return pickDateTime(raw, [
    '_created_at',
    'Requested_Date',
    'Requester_Date__Time',
    '_submitted_at',
    'CreatedAt',
  ]);
}

function itemCompletedAt(raw, { applicationId } = {}) {
  const explicit = pickDateTime(raw, [
    '_completed_at',
    '_closed_at',
    'Completed_On',
    'Closed_On',
    'Completed_Date',
    'Closed_Date',
  ]);
  if (explicit) return explicit;
  const status = normalizeProcessStatus(raw);
  const leadStatus = String(raw?.Lead_Status || raw?.Status || '').toLowerCase().trim();
  const closed =
    applicationId === ITSM_APP_ID
      ? isItsmBusinessClosed(raw)
      : status === 'Completed' ||
        status === 'Closed' ||
        leadStatus === 'close' ||
        leadStatus === 'closed' ||
        leadStatus === 'completed' ||
        leadStatus === 'done';
  if (!closed) return null;
  return pickDateTime(raw, ['_modified_at']);
}

function countOpenedClosedToday(items, { applicationId } = {}) {
  let openedToday = 0;
  let closedToday = 0;
  const now = new Date();
  for (const raw of items || []) {
    const created = itemCreatedAt(raw);
    if (created) {
      const createdAt = new Date(created);
      if (!Number.isNaN(createdAt.getTime()) && isSameCalendarDay(createdAt, now)) {
        openedToday += 1;
      }
    }
    const completed = itemCompletedAt(raw, { applicationId });
    if (completed) {
      const completedAt = new Date(completed);
      if (!Number.isNaN(completedAt.getTime()) && isSameCalendarDay(completedAt, now)) {
        closedToday += 1;
      }
    }
  }
  return { opened_today: openedToday, closed_today: closedToday };
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

function applyItemCountsToUsers(userRows, items, { applicationId } = {}) {
  const itsm = applicationId === ITSM_APP_ID;
  const byUser = new Map(userRows.map((u) => [u.user_id, { ...u }]));
  for (const item of items || []) {
    if (isDraftRaw(item)) continue;
    const status = normalizeProcessStatus(item);
    const rejected = isRejectedStatus(item);
    const closed = !rejected && (itsm ? isItsmBusinessClosed(item) : status === 'Completed' || status === 'Closed');
    const open = !rejected && (itsm ? isItsmBusinessOpen(item) : status === 'InProgress');
    const assigneeIds = new Set();
    pushUserId(assigneeIds, item.Assigned_To);
    pushUserId(assigneeIds, item.Assignee);
    pushUserId(assigneeIds, item.assigned_to);
    pushUserId(assigneeIds, item.AssignedTo);
    pushUserId(assigneeIds, item.Owner);
    pushUserId(assigneeIds, item._current_assigned_to);
    // Non-ITSM: fall back to creator for completed attribution when no assignee.
    if (!itsm && !assigneeIds.size) {
      pushUserId(assigneeIds, item._created_by);
    }
    for (const userId of assigneeIds) {
      const row = byUser.get(userId);
      if (!row) continue;
      row.assigned = (row.assigned || 0) + 1;
      if (open) row.open_count = (row.open_count || 0) + 1;
      if (closed) row.completed_count = (row.completed_count || 0) + 1;
      if (rejected) row.rejected_count = (row.rejected_count || 0) + 1;
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
  if (isP2pApplication(applicationId)) {
    return fetchLiveP2pMetrics(environment, applicationId, { persistCache });
  }

  const inflightKey = `${environment}:${applicationId}:${persistCache ? '1' : '0'}`;
  if (fetchLiveAppMetrics._inflight?.has(inflightKey)) {
    return fetchLiveAppMetrics._inflight.get(inflightKey);
  }
  if (!fetchLiveAppMetrics._inflight) fetchLiveAppMetrics._inflight = new Map();
  const pending = fetchLiveAppMetricsUncached(environment, applicationId, { persistCache })
    .finally(() => fetchLiveAppMetrics._inflight.delete(inflightKey));
  fetchLiveAppMetrics._inflight.set(inflightKey, pending);
  return pending;
}

async function fetchLiveAppMetricsUncached(environment, applicationId, { persistCache = true } = {}) {

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
  let rejectedTickets = 0;
  for (const processId of processIds) {
    const items = await fetchAllProcessItems({
      environment,
      accountId,
      processId,
      credentials,
    });
    allItems = allItems.concat(
      (items || []).filter((raw) => !isDraftRaw(raw)).map((raw) => ({ ...raw, _process_id: processId, process_id: processId })),
    );
    const counts = countTicketStatuses((items || []).filter((raw) => !isDraftRaw(raw)), { applicationId });
    openTickets += counts.open;
    closedTickets += counts.closed;
    rejectedTickets += counts.rejected;
  }
  const sourceBuckets = countTicketSources(allItems);
  const todayCounts = countOpenedClosedToday(allItems, { applicationId });
  const todayItems = (allItems || []).filter((raw) => {
    const created = itemCreatedAt(raw);
    if (created) {
      const createdAt = new Date(created);
      if (!Number.isNaN(createdAt.getTime()) && isSameCalendarDay(createdAt, new Date())) return true;
    }
    const completed = itemCompletedAt(raw, { applicationId });
    if (completed) {
      const completedAt = new Date(completed);
      if (!Number.isNaN(completedAt.getTime()) && isSameCalendarDay(completedAt, new Date())) return true;
    }
    return false;
  });
  const sourceBucketsToday = countTicketSources(todayItems);
  // Kissflow list API omits _modified_at/_completed_at — Closed Today would stay 0.
  // Prefer PostgreSQL detail payloads (from ingest) when the live list has no completion timestamps.
  const listHasCompletionTs = allItems.some(
    (item) => item && (item._modified_at || item._completed_at || item._closed_at),
  );
  if (!listHasCompletionTs) {
    const pgToday = await loadItemTodayCounts(pool, environment, applicationId);
    if (pgToday.closed_today > todayCounts.closed_today) {
      todayCounts.closed_today = pgToday.closed_today;
    }
    if (!todayCounts.opened_today && pgToday.opened_today) {
      todayCounts.opened_today = pgToday.opened_today;
    }
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
    const lastSignIn = row.last_sign_in || snap?.last_sign_in || null;
    return {
      ...row,
      last_sign_in: lastSignIn,
      ever_logged_in: row.ever_logged_in || snap?.ever_logged_in || Boolean(lastSignIn),
      has_app_role: memberIds.has(row.user_id) || Boolean(snap?.has_app_role) || row.has_app_role,
    };
  });
  userRows = applyItemCountsToUsers(userRows, allItems, { applicationId });
  userRows = userRows
    .map((row) => {
      const display = resolvePersonDisplayName(row.user_name, row.email, row.user_id);
      if (!display) return null;
      return { ...row, user_name: display };
    })
    .filter(Boolean);

  const totals = buildEngagementTotals(userRows);
  totals.open_tickets = openTickets;
  totals.closed_tickets = closedTickets;
  totals.rejected_tickets = rejectedTickets;
  totals.by_source = sourceBuckets;
  totals.by_source_today = sourceBucketsToday;
  totals.opened_today = todayCounts.opened_today;

  const fetchedAt = new Date().toISOString();
  const result = {
    application_id: applicationId,
    application_name: friendlyApplicationName(applicationId, appRow.application_name),
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
      opened_today: todayCounts.opened_today,
      closed_today: todayCounts.closed_today,
    },
    live_user_count: userRows.length,
    related_user_count: relatedIds.size,
    item_count: allItems.length,
    sign_in_today_basis: 'Asia/Kolkata',
  };

  if (persistCache) {
    const records = enrichRecordsWithAssigneeCompany(
      buildLiveRecordRows(allItems, applicationId),
      userRows,
      { skipAssigneeStamp: isItsmApp(applicationId) },
    );
    const pmPortfolio = isPmApp(applicationId) ? buildPmPortfolioFromRecords(records) : null;
    const items = userRows.map((row) => ({
      user_id: row.user_id,
      user_name: row.user_name,
      email: row.email,
      user_type: null,
      active_status: row.active_status || (row.is_active === false ? 'Inactive' : 'Active'),
      last_sign_in: row.last_sign_in,
      ever_logged_in: row.ever_logged_in,
      assigned: row.assigned || 0,
      open: row.open_count || 0,
      completed: row.completed_count || 0,
      rejected: row.rejected_count || 0,
      role_names: [],
      has_assignment: (row.assigned || 0) > 0,
      has_app_role: Boolean(row.has_app_role),
      source_payload: {
        company: row.company || '',
        company_key: row.company_key || '',
        is_active: row.is_active !== false,
      },
    }));
    await saveEngagementCache(pool, {
      environment,
      applicationId,
      payload: {
        fetched_at: fetchedAt,
        snapshot_at: fetchedAt,
        data_source: 'live',
        items,
        records,
        totals: {
          total_users: items.length,
          active_today: items.filter((r) => isLoggedInToday(r.last_sign_in)).length,
          inactive: items.filter((r) => {
            const sp = r.source_payload || {};
            if (sp.is_active === false || String(r.active_status || '').toLowerCase() === 'inactive') return true;
            return Boolean(r.last_sign_in && !isLoggedInToday(r.last_sign_in));
          }).length,
          never_logged_in: items.filter((r) => !r.ever_logged_in && !r.last_sign_in).length,
          total_assigned: items.reduce((sum, r) => sum + Number(r.assigned || 0), 0),
          with_assignments: items.filter((r) => Number(r.assigned || 0) > 0).length,
          with_app_role: items.filter((r) => r.has_app_role).length,
          open_tickets: openTickets,
          closed_tickets: closedTickets,
          rejected_tickets: rejectedTickets,
          by_source: sourceBuckets,
          by_source_today: sourceBucketsToday,
          opened_today: todayCounts.opened_today,
          closed_today: todayCounts.closed_today,
          ...(pmPortfolio ? {
            portfolio: pmPortfolio,
            projects_total: pmPortfolio.projects_total,
          } : {}),
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
