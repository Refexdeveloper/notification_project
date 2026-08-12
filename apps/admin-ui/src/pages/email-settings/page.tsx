import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Mail, RefreshCw, ShieldAlert } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAuth } from '@/hooks/AuthContext';
import { isBackendApiMode } from '@/services/backendApi';
import {
  loadSmtpSettings,
  updateSmtpSettings,
  type SmtpSettings,
} from '@/services/emailSettingsApi';

export default function EmailSettingsPage() {
  const backendMode = isBackendApiMode();
  const { isAdmin } = useAuth();
  const [settings, setSettings] = useState<SmtpSettings | null>(null);
  const [smtpUser, setSmtpUser] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [loading, setLoading] = useState(backendMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!backendMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const result = await loadSmtpSettings();
    if (result.error) setError(result.error);
    if (result.settings) {
      setSettings(result.settings);
      setSmtpUser(result.settings.smtp_user || '');
    }
    setLoading(false);
  }, [backendMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setError('');
    setMessage('');
    const nextUser = smtpUser.trim().toLowerCase();
    if (!nextUser || !nextUser.includes('@')) {
      setError('Enter a valid SMTP login email');
      return;
    }
    if (!appPassword.trim() && !settings?.password_configured) {
      setError('Enter a Gmail app password (first-time setup)');
      return;
    }

    setSaving(true);
    const res = await updateSmtpSettings({
      smtp_user: nextUser,
      app_password: appPassword.trim() || undefined,
    });
    setSaving(false);

    if (!res.ok || !res.settings) {
      setError(res.error || 'Could not save email settings');
      return;
    }

    setSettings(res.settings);
    setSmtpUser(res.settings.smtp_user || nextUser);
    setAppPassword('');
    const parts = ['Email settings saved to Secret Manager.'];
    if (res.settings.schedule_runner_refreshed) {
      parts.push('Schedule runner was refreshed to use the new password.');
    } else if (res.settings.warning) {
      parts.push(res.settings.warning);
    }
    setMessage(parts.join(' '));
  };

  return (
    <Layout
      title="Email settings"
      breadcrumbs={[{ label: 'Email settings' }]}
    >
      <div className="max-w-2xl space-y-4">
        {!backendMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Email settings require backend-api mode.
          </div>
        )}

        {!isAdmin && backendMode && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-foreground-700 flex gap-2">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            Only Admin users can view or change SMTP credentials.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <GlassCard className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="icon-well shrink-0">
                <Mail className="w-4 h-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-foreground-900">Gmail SMTP login</h2>
                <p className="text-xs text-foreground-500 mt-0.5">
                  Used by scheduled and test report emails. Stored in GCP Secret Manager — never in the database.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading || !isAdmin}
              onClick={() => void load()}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          <form className="space-y-4" onSubmit={onSave} autoComplete="off">
            <div>
              <label className="block text-xs font-semibold text-foreground-600 mb-1.5">
                SMTP login email
              </label>
              <Input
                type="email"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="support@refexone.com"
                disabled={!isAdmin || loading || saving}
                autoComplete="off"
              />
              <p className="text-[11px] text-foreground-500 mt-1">
                Must match the Google mailbox that owns the app password (or a verified Send mail as alias).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground-600 mb-1.5">
                App password
              </label>
              <Input
                type="password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder={
                  settings?.password_configured
                    ? 'Leave blank to keep current password'
                    : 'Paste new Gmail app password'
                }
                disabled={!isAdmin || loading || saving}
                autoComplete="new-password"
              />
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-foreground-500">
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                {settings?.password_configured ? (
                  <span>
                    App password is <strong className="text-emerald-700">configured</strong>. Enter a new
                    one only when rotating.
                  </span>
                ) : (
                  <span>No app password configured yet.</span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-[11px] text-foreground-600 space-y-1">
              <p>
                Host: <span className="font-mono">{settings?.host || 'smtp.gmail.com'}</span>
                {' · '}
                Port: <span className="font-mono">{settings?.port || 465}</span>
              </p>
              {settings?.secret_hints && (
                <p className="font-mono text-foreground-500 break-all">
                  Secrets: {settings.secret_hints.smtp_user} / {settings.secret_hints.app_password}
                  {settings.secret_hints.project ? ` (${settings.secret_hints.project})` : ''}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="submit" disabled={!isAdmin || loading || saving}>
                {saving ? 'Saving…' : 'Save email settings'}
              </Button>
            </div>
          </form>
        </GlassCard>
      </div>
    </Layout>
  );
}
