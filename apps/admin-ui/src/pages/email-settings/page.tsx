import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Mail, RefreshCw, ShieldAlert } from 'lucide-react';
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
import { refreshDashboardLive } from '@/services/dashboardApi';
import {
  loadApplicationsFromBackend,
  resolveBackendApplicationId,
  saveApplicationEmbedUrl,
} from '@/services/applicationsApi';
import { friendlyApplicationName, isHiddenNeApplication } from '@/lib/processLabels';
import { defaultEmbedAppUrl } from '@/lib/embedMode';
import type { KissflowApplication } from '@/mocks/applications';

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
  const [apps, setApps] = useState<KissflowApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(backendMode);
  const [refreshingAppId, setRefreshingAppId] = useState('');
  const [embedDrafts, setEmbedDrafts] = useState<Record<string, string>>({});
  const [savingEmbedId, setSavingEmbedId] = useState('');

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

  const loadApps = useCallback(async () => {
    if (!backendMode) {
      setAppsLoading(false);
      return;
    }
    setAppsLoading(true);
    const result = await loadApplicationsFromBackend();
    setApps(result.applications || []);
    if (result.error && !result.applications?.length) setError(result.error);
    setAppsLoading(false);
  }, [backendMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const refreshApps = useMemo(
    () =>
      apps
        .filter((app) => !isHiddenNeApplication(app.appId, app.displayName || app.name))
        .map((app) => {
          const applicationId = resolveBackendApplicationId(app);
          const name = friendlyApplicationName(applicationId, app.displayName || app.name);
          return {
            applicationId,
            name,
            embedUrl: app.embedUrl || defaultEmbedAppUrl(applicationId, name),
          };
        })
        .filter((app, index, list) => list.findIndex((row) => row.applicationId === app.applicationId) === index)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [apps],
  );

  const onForceRefreshApp = async (applicationId: string, name: string) => {
    if (!isAdmin || refreshingAppId) return;
    setRefreshingAppId(applicationId);
    setError('');
    setMessage('');
    const res = await refreshDashboardLive('production', { applicationId, live: true });
    setRefreshingAppId('');
    if (!res.ok) {
      setError(res.error || `Full force refresh failed for ${name}`);
      return;
    }
    setMessage(`Full force refresh completed for ${name}. Dashboard and records were restored from Kissflow.`);
  };

  const onSaveEmbedLink = async (applicationId: string, name: string, fallback: string) => {
    if (!isAdmin || savingEmbedId) return;
    const next = (embedDrafts[applicationId] ?? fallback).trim();
    setSavingEmbedId(applicationId);
    setError('');
    setMessage('');
    const res = await saveApplicationEmbedUrl(applicationId, next);
    setSavingEmbedId('');
    if (!res.ok) {
      setError(res.error || `Could not save embed link for ${name}`);
      return;
    }
    const saved = res.embedUrl || next || fallback;
    setEmbedDrafts((prev) => ({ ...prev, [applicationId]: saved }));
    setApps((prev) =>
      prev.map((app) =>
        resolveBackendApplicationId(app) === applicationId ? { ...app, embedUrl: saved } : app,
      ),
    );
    setMessage(`Embed link saved for ${name}. Embed dashboard Open will use this URL.`);
  };

  const onCopyEmbedLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Embed link copied.');
    } catch {
      setError('Could not copy the embed link.');
    }
  };

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
      title="Settings"
      breadcrumbs={[{ label: 'Settings' }]}
    >
      <div className="max-w-4xl space-y-4">
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
            <div className="flex items-center gap-2">
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

        <GlassCard className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="icon-well shrink-0">
              <RefreshCw className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground-900">Application data refresh</h2>
              <p className="text-xs text-foreground-500 mt-0.5">
                Full force refresh one application at a time. Paste or edit the embed Open link for each
                project — Apply stores it so the embed dashboard uses that URL.
              </p>
            </div>
          </div>

          {appsLoading && (
            <p className="text-sm text-foreground-500">Loading applications…</p>
          )}

          {!appsLoading && refreshApps.length === 0 && (
            <p className="text-sm text-foreground-500">No registered applications found.</p>
          )}

          {refreshApps.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
            {refreshApps.map((app) => {
              const busy = refreshingAppId === app.applicationId;
              const savingLink = savingEmbedId === app.applicationId;
              const draft = embedDrafts[app.applicationId] ?? app.embedUrl;
              return (
                <div
                  key={app.applicationId}
                  className="space-y-2 bg-white px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 truncate">{app.name}</p>
                      <p className="text-[11px] font-mono text-foreground-500 truncate">{app.applicationId}</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={!isAdmin || Boolean(refreshingAppId)}
                      onClick={() => void onForceRefreshApp(app.applicationId, app.name)}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${busy ? 'animate-spin' : ''}`} />
                      {busy ? 'Refreshing…' : 'Full force refresh'}
                    </Button>
                  </div>
                  <label className="block text-[11px] font-semibold text-foreground-600">
                    Embed link
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={draft}
                        onChange={(e) =>
                          setEmbedDrafts((prev) => ({ ...prev, [app.applicationId]: e.target.value }))
                        }
                        disabled={!isAdmin || Boolean(savingEmbedId)}
                        className="font-mono text-[11px]"
                        spellCheck={false}
                      />
                      <div className="flex shrink-0 gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!isAdmin || Boolean(savingEmbedId)}
                          onClick={() => void onSaveEmbedLink(app.applicationId, app.name, app.embedUrl)}
                        >
                          {savingLink ? 'Saving…' : 'Apply'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void onCopyEmbedLink(draft)}
                        >
                          <Copy className="w-3.5 h-3.5 mr-1.5" />
                          Copy
                        </Button>
                      </div>
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
          )}
        </GlassCard>
      </div>
    </Layout>
  );
}
