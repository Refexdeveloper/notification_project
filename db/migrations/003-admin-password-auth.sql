-- 003: Platform admin password auth (ADMIN + VIEWER)
BEGIN;

ALTER TABLE engagement_reporting.admin_user
  ADD COLUMN IF NOT EXISTS password_hash text;

INSERT INTO engagement_reporting.admin_role (name) VALUES ('ADMIN')
ON CONFLICT (name) DO NOTHING;
INSERT INTO engagement_reporting.admin_role (name) VALUES ('VIEWER')
ON CONFLICT (name) DO NOTHING;

INSERT INTO engagement_reporting.schema_migration (migration_id, applied_by, checksum)
VALUES ('003-admin-password-auth', 'migrator', 'pending-runtime-checksum')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
