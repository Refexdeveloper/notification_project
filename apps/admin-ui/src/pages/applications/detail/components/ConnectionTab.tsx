import { useState } from 'react';
import { saveApplication, type KissflowApplication } from '@/mocks/applications';
import { getConnection, type AppConnection } from '@/mocks/connection';
import { kissflowFetch, kissflowHost } from '@/services/kissflowClient';

interface ConnectionTabProps {
  app: KissflowApplication;
  onSaved?: () => void;
}

export default function ConnectionTab({ app, onSaved }: ConnectionTabProps) {
  const initial = getConnection(app.id);
  const [accessKeyId, setAccessKeyId] = useState(app.accessKeyId || initial.accessKeyId);
  const [secret, setSecret] = useState('');
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<AppConnection['lastTestStatus']>(
    initial.lastTestStatus,
  );
  const [latency, setLatency] = useState<number | null>(initial.lastLatencyMs);
  const [testMessage, setTestMessage] = useState('');

  const baseUrl = kissflowHost(app);

  const testConnection = async () => {
    setTesting(true);
    setTestMessage('');
    const started = performance.now();
    const keyId = accessKeyId.trim() || app.accessKeyId;
    const keySecret = secret.trim() || app.accessKeySecret;

    if (!keyId || !keySecret) {
      setTestStatus('failed');
      setTestMessage('Access Key ID and Secret are required.');
      setTesting(false);
      return;
    }

    const probeApp: KissflowApplication = {
      ...app,
      accessKeyId: keyId,
      accessKeySecret: keySecret,
    };

    const res = await kissflowFetch(
      probeApp,
      `/user/2/${encodeURIComponent(app.accountId)}?page_number=1&page_size=1`,
    );
    const ms = Math.round(performance.now() - started);
    setLatency(ms);

    if (res.ok) {
      setTestStatus('success');
      setTestMessage(`Connected · ${ms}ms`);
    } else {
      setTestStatus('failed');
      setTestMessage(res.error || `HTTP ${res.status}`);
    }
    setTesting(false);
  };

  const save = () => {
    if (!accessKeyId.trim()) return;
    saveApplication({
      ...app,
      accessKeyId: accessKeyId.trim(),
      accessKeySecret: secret.trim() ? secret : app.accessKeySecret,
      connected: true,
      lastSync: new Date().toISOString(),
    });
    setSecret('');
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white border border-background-300/60 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">Kissflow Connection</h3>
            <p className="text-xs text-foreground-500 mt-0.5">
              Credentials used for discovery, sync, API Explorer, and User Engagement
            </p>
          </div>
          <StatusPill status={testStatus} latency={latency} />
        </div>

        <div className="space-y-3">
          <Field label="Base URL">
            <input
              value={baseUrl}
              readOnly
              className="w-full h-9 px-3 text-sm font-mono rounded-lg border border-background-300/60 bg-background-50 text-foreground-600 outline-none"
            />
            <p className="text-[11px] text-foreground-400 mt-1">
              Derived from subdomain + region. Change those under{' '}
              <span className="font-medium text-foreground-600">Settings → Edit</span>.
            </p>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Account ID">
              <input
                value={app.accountId}
                readOnly
                className="w-full h-9 px-3 text-sm font-mono rounded-lg border border-background-300/60 bg-background-50 text-foreground-600 outline-none"
              />
            </Field>
            <Field label="Access Key ID">
              <input
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                className="w-full h-9 px-3 text-sm font-mono rounded-lg border border-background-300/60 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              />
            </Field>
          </div>
          <Field label="Access Key Secret">
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={app.accessKeySecret ? '••••••••  (leave blank to keep)' : 'Enter secret'}
              className="w-full h-9 px-3 text-sm font-mono rounded-lg border border-background-300/60 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </Field>
          {testMessage && (
            <p
              className={`text-xs ${
                testStatus === 'success' ? 'text-accent-700' : 'text-red-600'
              }`}
            >
              {testMessage}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-background-100 flex-wrap">
          <button
            onClick={testConnection}
            disabled={testing}
            className="h-9 px-3.5 rounded-lg border border-background-300/60 text-sm font-medium text-foreground-700 hover:bg-background-50 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {testing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-foreground-300 border-t-foreground-700 rounded-full animate-spin"></span>
                Testing...
              </>
            ) : (
              <>
                <i className="ri-plug-line"></i>
                Test Connection
              </>
            )}
          </button>
          <button
            onClick={save}
            className="h-9 px-3.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <i className="ri-save-line"></i>
            Save Connection
          </button>
          {saved && <span className="text-xs text-accent-700 font-medium">Saved</span>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function StatusPill({
  status,
  latency,
}: {
  status: AppConnection['lastTestStatus'];
  latency: number | null;
}) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-accent-50 text-accent-700">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-500"></span>
        Connected{latency != null ? ` · ${latency}ms` : ''}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-red-50 text-red-700">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-background-100 text-foreground-600">
      Untested
    </span>
  );
}
