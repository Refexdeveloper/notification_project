import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  saveDiscoveredFields,
  type KissflowApplication,
} from '@/mocks/applications';
import { syncFieldsFromAdminItems } from '@/services/fieldDiscovery';
import { isBackendApiMode } from '@/services/backendApi';
import { syncAllFieldsOnBackend, syncFieldsOnBackend } from '@/services/fieldsApi';
import { processLabel } from '@/lib/processLabels';

interface DiscoveryTabProps {
  app: KissflowApplication;
  onSynced?: () => void;
}

export default function DiscoveryTab({ app, onSynced }: DiscoveryTabProps) {
  const backendMode = isBackendApiMode();
  const processOptions = useMemo(
    () => (app.processIds || []).map((id) => id.trim()).filter(Boolean),
    [app.processIds],
  );
  const [selectedProcessId, setSelectedProcessId] = useState(
    () => processOptions[0] || app.appId || '',
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [lastMessage, setLastMessage] = useState('');
  const [fields, setFields] = useState(app.discoveredFields || []);
  const [itemCount, setItemCount] = useState(app.discoveredItemCount);
  const [lastSyncAt, setLastSyncAt] = useState(app.lastFieldSyncAt);

  useEffect(() => {
    setFields(app.discoveredFields || []);
    setItemCount(app.discoveredItemCount);
    setLastSyncAt(app.lastFieldSyncAt);
  }, [app.discoveredFields, app.discoveredItemCount, app.lastFieldSyncAt]);

  useEffect(() => {
    if (!processOptions.length) {
      setSelectedProcessId(app.appId || '');
      return;
    }
    if (!processOptions.includes(selectedProcessId)) {
      setSelectedProcessId(processOptions[0]);
    }
  }, [processOptions, selectedProcessId, app.appId]);

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

  const runFieldSync = useCallback(
    async (mode: 'selected' | 'all' = 'selected') => {
      setSyncing(true);
      setError('');
      setLastMessage('');

      if (backendMode) {
        if (mode === 'all') {
          const result = await syncAllFieldsOnBackend(app);
          if (!result.ok) {
            setError(result.error || 'Sync failed');
            setSyncing(false);
            return;
          }
          setFields(result.fields);
          setItemCount(result.itemCount);
          setLastSyncAt(result.syncedAt);
          setLastMessage(
            `Synced fields for ${result.syncedProcesses || 0} process(es)` +
              (result.failedProcesses?.length
                ? ` · ${result.failedProcesses.length} failed`
                : '') +
              (result.fields.length ? ` · showing ${result.fields.length} fields from last process` : ''),
          );
          onSynced?.();
          setSyncing(false);
          return;
        }

        const result = await syncFieldsOnBackend(app, selectedProcessId);
        if (!result.ok) {
          setError(result.error || 'Sync failed');
          setSyncing(false);
          return;
        }
        setFields(result.fields);
        setItemCount(result.itemCount);
        setLastSyncAt(result.syncedAt);
        setLastMessage(
          `Synced ${result.fields.length} fields from ${selectedProcessId}` +
            (result.itemCount ? ` · ${result.itemCount} total items` : ''),
        );
        onSynced?.();
        setSyncing(false);
        return;
      }

      const result = await syncFieldsFromAdminItems(app, { processId: selectedProcessId });
      if (!result.ok) {
        setError(result.error || 'Sync failed');
        setSyncing(false);
        return;
      }

      saveDiscoveredFields(app.id, result.fields, result.itemCount, {
        resourceId: selectedProcessId,
        adminProcessId: selectedProcessId,
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
    },
    [app, backendMode, selectedProcessId, onSynced],
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="bg-white border border-background-300/60 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">Field sync</h3>
            <p className="text-xs text-foreground-500 mt-0.5">
              Calls Admin Get-all-items for a registered process and derives fields from the response.
              Add more processes under App settings → Processes & resources.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {backendMode && processOptions.length > 1 && (
              <button
                onClick={() => void runFieldSync('all')}
                disabled={syncing || !processOptions.length}
                className="h-9 px-3.5 rounded-lg border border-primary-200 text-primary-700 bg-primary-50 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                Sync all processes
              </button>
            )}
            <button
              onClick={() => void runFieldSync('selected')}
              disabled={syncing || !selectedProcessId}
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
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Stat label="Account ID" value={app.accountId || '—'} mono />
          <label className="rounded-lg border border-background-200 bg-background-50/80 px-3 py-2 block">
            <span className="block text-[10px] uppercase tracking-wide text-foreground-400 font-semibold mb-1">
              Process
            </span>
            {processOptions.length > 1 ? (
              <select
                value={selectedProcessId}
                onChange={(e) => setSelectedProcessId(e.target.value)}
                className="w-full bg-transparent font-mono text-xs text-foreground-900 outline-none"
              >
                {processOptions.map((pid) => (
                  <option key={pid} value={pid}>
                    {processLabel(pid)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-xs text-foreground-900 break-all">
                {selectedProcessId || 'Not set'}
              </span>
            )}
          </label>
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

        {!selectedProcessId && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
            No process linked yet. Open App settings → Processes & resources, add a Process ID, then sync.
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
      </div>

      <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-background-200/70 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">Discovered fields</h3>
            <p className="text-xs text-foreground-500">
              {fields.length} field{fields.length === 1 ? '' : 's'}
              {itemCount ? ` · ${itemCount} items sampled source` : ''}
            </p>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter fields…"
            className="h-8 w-full sm:w-56 px-2.5 rounded-lg border border-background-300/60 text-xs outline-none focus:border-primary-300"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-foreground-500">
            No fields yet. Sync fields for a process to populate this list.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-background-50 text-xs text-foreground-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Label</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Sample</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((field) => (
                  <tr key={field.id || field.name} className="border-t border-background-100">
                    <td className="px-4 py-2.5 font-mono text-xs">{field.name}</td>
                    <td className="px-4 py-2.5">{field.label}</td>
                    <td className="px-4 py-2.5 text-foreground-600">{field.type}</td>
                    <td className="px-4 py-2.5 text-xs text-foreground-500 max-w-[240px] truncate">
                      {field.sample || '—'}
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
    <div className="rounded-lg border border-background-200 bg-background-50/80 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-foreground-400 font-semibold">{label}</p>
      <p className={`text-xs text-foreground-900 mt-0.5 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}
