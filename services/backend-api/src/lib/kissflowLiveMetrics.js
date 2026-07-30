'use strict';

const { getPool } = require('./db');
const { buildEngagementTotals } = require('./engagementSummary');
const { isLoggedInToday } = require('./reportTimezone');
const {
  resolveKissflowCredentials,
  fetchAllKissflowUsers,
  fetchAllProcessItems,
  pickString,
  pickDateTime,
  normalizeProcessStatus,
} = require('./kissflowClient');

const APP_MEMBER_QUERY = `
SELECT DISTINCT user_id
FROM (
  SELECT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
  UNION
  SELECT ia.principal_id AS user_id
  FROM engagement_reporting.item_assignment ia
  WHERE ia.environment = $1
    AND (ia.application_id = $2 OR ia.process_id = ANY($3::text[]))
    AND ia.principal_type = 'USER'
) members
WHERE user_id IS NOT NULL
`;

function normalizeUserRow(raw) {
  const lastSignIn = pickDateTime(raw, [
    'Last_Signin',
    'LastSignIn',
    'last_sign_in',
    'LastLogin',
    'Last_Login',
  ]);
  const everLoggedIn = Boolean(
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

async function fetchLiveAppMetrics(environment, applicationId) {
  const pool = getPool();
  const appResult = await pool.query(
    `SELECT application_name, source_payload
     FROM engagement_reporting.application
     WHERE environment = $1 AND application_id = $2 AND is_current = true
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
  const accountId = payload.kissflow_account_id;
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
  const memberResult = await pool.query(APP_MEMBER_QUERY, [environment, applicationId, processIds]);
  const memberIds = new Set(memberResult.rows.map((r) => r.user_id).filter(Boolean));

  const rawUsers = await fetchAllKissflowUsers({ environment, accountId, credentials });
  let userRows = rawUsers.map(normalizeUserRow).filter((u) => u.user_id);
  if (memberIds.size) {
    userRows = userRows.filter((u) => memberIds.has(u.user_id));
  }

  let openTickets = 0;
  let closedTickets = 0;
  for (const processId of processIds) {
    const items = await fetchAllProcessItems({
      environment,
      accountId,
      processId,
      credentials,
    });
    const counts = countTicketStatuses(items);
    openTickets += counts.open;
    closedTickets += counts.closed;
  }

  const totals = buildEngagementTotals(userRows);
  totals.open_tickets = openTickets;
  totals.closed_tickets = closedTickets;

  return {
    application_id: applicationId,
    application_name: appRow.application_name,
    snapshot_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
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
    sign_in_today_basis: 'Asia/Kolkata',
  };
}

module.exports = {
  fetchLiveAppMetrics,
  isLoggedInToday,
};
