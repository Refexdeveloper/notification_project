import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type SmtpSettings = {
  smtp_user: string;
  password_configured: boolean;
  host?: string;
  port?: number;
  secret_hints?: {
    smtp_user?: string;
    app_password?: string;
    project?: string;
  };
  note?: string;
  schedule_runner_refreshed?: boolean;
  warning?: string | null;
};

export async function loadSmtpSettings(): Promise<{
  settings: SmtpSettings | null;
  error?: string;
}> {
  if (!isBackendApiMode()) {
    return { settings: null, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<SmtpSettings>('/settings/smtp');
  if (!res.ok || !res.data) {
    return { settings: null, error: res.error || 'Failed to load email settings' };
  }
  return { settings: res.data };
}

export async function updateSmtpSettings(payload: {
  smtp_user?: string;
  app_password?: string;
}): Promise<{ ok: boolean; settings?: SmtpSettings; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const body: Record<string, string> = {};
  if (payload.smtp_user != null) body.smtp_user = payload.smtp_user;
  if (payload.app_password != null && payload.app_password.trim()) {
    body.app_password = payload.app_password;
  }

  const res = await apiV1Fetch<SmtpSettings>('/settings/smtp', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to update email settings' };
  }
  return { ok: true, settings: res.data };
}
