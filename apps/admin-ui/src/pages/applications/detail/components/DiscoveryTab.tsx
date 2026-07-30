import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  saveDiscoveredFields,
  type KissflowApplication,
} from '@/mocks/applications';
import { syncFieldsFromAdminItems } from '@/services/fieldDiscovery';
import { isBackendApiMode } from '@/services/backendApi';
import { syncFieldsOnBackend } from '@/services/fieldsApi';

interface DiscoveryTabProps {
  app: KissflowApplication;
  onSynced?: () => void;
}

export default function DiscoveryTab({ app, onSynced }: DiscoveryTabProps) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [lastMessage, setLastMessage] = useState('');
  const [fields, setFields] = useState(app.discoveredFields || []);
  const [itemCount, setItemCount] = useState(app.discoveredItemCount);
  const [lastSyncAt, setLastSyncAt] = useState(app.lastFieldSyncAt);

  const adminProcessId = (app.processIds || [])[0] || app.appId;

  useEffect(() => {
    setFields(app.discoveredFields || []);
    setItemCount(app.discoveredItemCount);
    setLastSyncAt(app.lastFieldSyncAt);
  }, [app.discoveredFields, app.discoveredItemCount, app.lastFieldSyncAt]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q),
    );
  }, [fields, filter]);

  const runFieldSync = useCallback(async () => {
    setSyncing(true);
    setError('');
    setLastMessage('');

    if (isBackendApiMode()) {
      const result = await syncFieldsOnBackend(app, adminProcessId);
      if (!result.ok) {
        setError(result.error || 'Sync failed');
        setSyncing(false);
        return;
      }
      setFields(result.fields);
      setItemCount(result.itemCount);
      setLastSyncAt(result.syncedAt);
      setLastMessage(
        `Synced ${result.fields.length} fields from ${result.sampled} sampled item(s)` +
          (result.itemCount ? ` · ${result.itemCount} total items` : ''),
      );
      onSynced?.();
      setSyncing(false);
      return;
    }

    const result = await syncFieldsFromAdminItems(app, { processId: adminProcessId });
    if (!result.ok) {
      setError(result.error || 'Sync failed');
      setSyncing(false);
      return;
    }

    saveDiscoveredFields(app.id, result.fields, result.itemCount, {
      resourceId: adminProcessId,
      adminProcessId,
    });
    setFields(result.fields);
    setItemCount(result.itemCount);
    setLastSyncAt(new Date().toISOString());
    setLastMessage(
      `Synced ${result.fields.length} fields from ${result.sampled} sampled item(s)` +
        (result.itemCount ? ` · ${result.itemCount} total items` : ''),
    );
    onSynced?.();
    setSyncing(false);
  }, [app, adminProcessId, onSynced]);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="bg-white border border-background-300/60 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">Field sync</h3>
            <p className="text-xs text-foreground-500 mt-0.5">
              Calls Admin Get-all-items for App ID and derives fields from the response.
            </p>
          </div>
          <button
            onClick={runFieldSync}
            disabled={syncing || !adminProcessId}
            className="h-9 px-3.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {syncing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Syncing fields...
              </>
            ) : (
              <>
                <i className="ri-refresh-line"></i>
                Sync fields
              </>
            )}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Stat label="Account ID" value={app.accountId || '—'} mono />
          <Stat label="App ID" value={adminProcessId || 'Not set'} mono />
          <Stat
            label="Last field sync"
            value={
              lastSyncAt
                ? new Date(lastSyncAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Never'
            }
          />
        </div>

        {!adminProcessId && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
            No process linked yet. Register the app with a process ID under Connect, then sync.
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
            {error}
          </div>
        )}
        {lastMessage && !error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-accent-50 border border-accent-100 text-sm text-accent-800">
            {lastMessage}
          </div>
        )}

        <p className="mt-3 text-[11px] text-foreground-400 font-mono break-all">
          GET /process/2/{app.accountId || '{account_id}'}/admin/{adminProcessId || '{process_id}'}
          /item?page_number=1&page_size=1000&apply_preference=1
        </p>
      </div>

      <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-background-200/70 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">Discovered fields</h3>
            <p className="text-[11px] text-foreground-400 mt-0.5">
              {fields.length} field{fields.length === 1 ? '' : 's'}
              {itemCount != null && itemCount > 0 ? ` · ${itemCount} items reported` : ''}
            </p>
          </div>
          <div className="relative">
            <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-400"></i>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter fields..."
              className="h-8 w-48 pl-7 pr-2.5 text-xs rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="w-10 h-10 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-2">
              <i className="ri-input-field text-foreground-300"></i>
            </div>
            <p className="text-sm text-foreground-500">
              {fields.length === 0
                ? 'No fields yet. Run Sync fields to pull from Kissflow.'
                : 'No fields match your filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-100 bg-background-50/80">
                  <th className="px-4 py-2 text-[10px] uppercase tracking-wide text-foreground-400 font-medium">
                    Field
                  </th>
                  <th className="px-4 py-2 text-[10px] uppercase tracking-wide text-foreground-400 font-medium">
                    Type
                  </th>
                  <th className="px-4 py-2 text-[10px] uppercase tracking-wide text-foreground-400 font-medium">
                    Sample
                  </th>
                  <th className="px-4 py-2 text-[10px] uppercase tracking-wide text-foreground-400 font-medium text-right">
                    Seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((field) => (
                  <tr key={field.id} className="border-b border-background-100/80 last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-medium text-foreground-900 font-mono">{field.name}</p>
                      <p className="text-[10px] text-foreground-400">{field.label}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-background-100 text-foreground-600 font-medium">
                        {field.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground-600 max-w-[220px] truncate font-mono">
                      {field.sample || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground-500 text-right tabular-nums">
                      {field.occurrences}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-background-50 border border-background-200/70 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-foreground-400 font-medium">{label}</p>
      <p
        className={`text-sm font-semibold text-foreground-900 mt-0.5 truncate ${
          mono ? 'font-mono text-xs' : ''
        }`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
