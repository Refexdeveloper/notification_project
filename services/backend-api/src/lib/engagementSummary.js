'use strict';

const APP_ENGAGEMENT_QUERY = `
WITH app_processes AS (
  SELECT process_id
  FROM engagement_reporting.process
  WHERE environment = $1
    AND application_id = $2
    AND is_current = true
),
latest_runs AS (
  SELECT DISTINCT ON (sr.process_id)
    sr.snapshot_run_id,
    sr.process_id
  FROM engagement_reporting.snapshot_run sr
  WHERE sr.environment = $1
    AND (
      sr.application_id = $2
      OR sr.process_id IN (SELECT process_id FROM app_processes)
    )
  ORDER BY sr.process_id, sr.created_at DESC
),
latest_user_snap AS (
  SELECT snapshot_run_id, snapshot_at
  FROM engagement_reporting."user"
  WHERE environment = $1
  ORDER BY snapshot_at DESC
  LIMIT 1
),
app_member AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
  UNION
  SELECT DISTINCT ia.principal_id AS user_id
  FROM engagement_reporting.item_assignment ia
  INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
  WHERE ia.environment = $1
    AND ia.principal_type = 'USER'
    AND (
      ia.application_id = $2
      OR ia.process_id IN (SELECT process_id FROM app_processes)
    )
  UNION
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.item_assignment ia
  INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
  INNER JOIN engagement_reporting.principal_user pu
    ON pu.environment = ia.environment
   AND pu.application_id = $2
   AND pu.principal_id = ia.principal_id
   AND pu.principal_type = ia.principal_type
   AND pu.valid_to IS NULL
  WHERE ia.environment = $1
    AND ia.principal_type = 'APP_ROLE'
    AND (
      ia.application_id = $2
      OR ia.process_id IN (SELECT process_id FROM app_processes)
    )
),
role_names AS (
  SELECT
    pu.user_id,
    array_agg(
      DISTINCT COALESCE(p.principal_name, p.principal_id)
      ORDER BY COALESCE(p.principal_name, p.principal_id)
    ) AS role_names
  FROM engagement_reporting.principal_user pu
  JOIN engagement_reporting.principal p
    ON p.environment = pu.environment
   AND p.application_id = pu.application_id
   AND p.principal_id = pu.principal_id
   AND p.principal_type = pu.principal_type
  WHERE pu.environment = $1
    AND pu.application_id = $2
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
  GROUP BY pu.user_id
),
assignment_counts AS (
  SELECT user_id, SUM(assigned)::int AS assigned, SUM(open_count)::int AS open_count,
         SUM(completed_count)::int AS completed_count, SUM(rejected_count)::int AS rejected_count
  FROM (
    SELECT
      ia.principal_id AS user_id,
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE i.process_status = 'InProgress')::int AS open_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Completed')::int AS completed_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Withdrawn')::int AS rejected_count
    FROM engagement_reporting.item_assignment ia
    INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
    INNER JOIN engagement_reporting.item i
      ON i.environment = ia.environment
     AND i.process_id = ia.process_id
     AND i.instance_id = ia.instance_id
     AND i.snapshot_at = ia.snapshot_at
    WHERE ia.environment = $1
      AND ia.principal_type = 'USER'
      AND (
        ia.application_id = $2
        OR ia.process_id IN (SELECT process_id FROM app_processes)
      )
    GROUP BY ia.principal_id
    UNION ALL
    SELECT
      pu.user_id,
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE i.process_status = 'InProgress')::int AS open_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Completed')::int AS completed_count,
      COUNT(*) FILTER (WHERE i.process_status = 'Withdrawn')::int AS rejected_count
    FROM engagement_reporting.item_assignment ia
    INNER JOIN latest_runs lr ON ia.snapshot_run_id = lr.snapshot_run_id
    INNER JOIN engagement_reporting.principal_user pu
      ON pu.environment = ia.environment
     AND pu.application_id = $2
     AND pu.principal_id = ia.principal_id
     AND pu.principal_type = ia.principal_type
     AND pu.valid_to IS NULL
    INNER JOIN engagement_reporting.item i
      ON i.environment = ia.environment
     AND i.process_id = ia.process_id
     AND i.instance_id = ia.instance_id
     AND i.snapshot_at = ia.snapshot_at
    WHERE ia.environment = $1
      AND ia.principal_type = 'APP_ROLE'
      AND (
        ia.application_id = $2
        OR ia.process_id IN (SELECT process_id FROM app_processes)
      )
    GROUP BY pu.user_id
  ) merged
  GROUP BY user_id
)
SELECT
  u.user_id,
  u.user_name,
  u.email,
  u.user_type,
  u.active_status,
  u.last_sign_in,
  u.ever_logged_in,
  COALESCE(ac.assigned, 0) AS assigned,
  COALESCE(ac.open_count, 0) AS open_count,
  COALESCE(ac.completed_count, 0) AS completed_count,
  COALESCE(ac.rejected_count, 0) AS rejected_count,
  COALESCE(rn.role_names, ARRAY[]::text[]) AS role_names,
  (ac.user_id IS NOT NULL) AS has_assignment,
  (rn.user_id IS NOT NULL) AS has_app_role,
  u.source_payload,
  (SELECT snapshot_at FROM latest_user_snap) AS snapshot_at
FROM engagement_reporting."user" u
INNER JOIN app_member am ON am.user_id = u.user_id
LEFT JOIN assignment_counts ac ON ac.user_id = u.user_id
LEFT JOIN role_names rn ON rn.user_id = u.user_id
WHERE u.environment = $1
  AND u.snapshot_at = (SELECT snapshot_at FROM latest_user_snap)
ORDER BY u.user_name NULLS LAST, u.email NULLS LAST
`;

function isLoggedInToday(lastSignIn) {
  if (!lastSignIn) return false;
  const login = new Date(lastSignIn);
  if (Number.isNaN(login.getTime())) return false;
  const now = new Date();
  return (
    login.getFullYear() === now.getFullYear() &&
    login.getMonth() === now.getMonth() &&
    login.getDate() === now.getDate()
  );
}

function buildEngagementTotals(rows) {
  const totalUsers = rows.length;
  const activeToday = rows.filter((row) => isLoggedInToday(row.last_sign_in)).length;
  const everLoggedIn = rows.filter((row) => row.ever_logged_in || row.last_sign_in).length;
  return {
    total_users: totalUsers,
    active_today: activeToday,
    inactive: rows.filter((row) => row.last_sign_in && !isLoggedInToday(row.last_sign_in)).length,
    never_logged_in: rows.filter((row) => !row.ever_logged_in && !row.last_sign_in).length,
    total_assigned: rows.reduce((sum, row) => sum + Number(row.assigned || 0), 0),
    with_assignments: rows.filter((row) => Number(row.assigned || 0) > 0).length,
    with_app_role: rows.filter((row) => row.has_app_role).length,
    open_tickets: rows.reduce((sum, row) => sum + Number(row.open_count || 0), 0),
    closed_tickets: rows.reduce((sum, row) => sum + Number(row.completed_count || 0), 0),
    sign_in_rate_overall: totalUsers ? Math.round((everLoggedIn / totalUsers) * 100) : 0,
    sign_in_rate_today: totalUsers ? Math.round((activeToday / totalUsers) * 100) : 0,
  };
}

module.exports = {
  APP_ENGAGEMENT_QUERY,
  buildEngagementTotals,
  isLoggedInToday,
};
