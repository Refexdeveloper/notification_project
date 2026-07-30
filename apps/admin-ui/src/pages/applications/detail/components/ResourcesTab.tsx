import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getApplicationById,
  saveDiscoveredFields,
  type KissflowApplication,
} from '@/mocks/applications';
import { resourceTypeLabel, type KissflowResource, type ResourceType } from '@/mocks/resources';
import { resolveProcessIdForAdmin } from '@/services/kissflowClient';
import { syncFieldsFromAdminItems } from '@/services/fieldDiscovery';
import { persistResourceFieldsToServer } from '@/services/resourceFieldSync';
import { buildResourcesFromApp } from '../utils/buildResources';

interface ResourcesTabProps {
  app: KissflowApplication;
  onSynced?: () => void;
}

type Filter = 'all' | ResourceType;

const statusStyles: Record<KissflowResource['status'], string> = {
  synced: 'bg-accent-50 text-accent-700',
  stale: 'bg-amber-50 text-amber-700',
  error: 'bg-red-50 text-red-700',
  pending: 'bg-background-100 text-foreground-600',
};

export default function ResourcesTab({ app: appProp, onSynced }: ResourcesTabProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState('');
  const [revision, setRevision] = useState(0);

  const app = useMemo(() => {
    void revision;
    return getApplicationById(appProp.id) || appProp;
  }, [appProp, revision]);

  const all = useMemo(() => buildResourcesFromApp(app), [app]);

  const filtered = useMemo(() => {
    return all.filter((r) => {
      const matchType = filter === 'all' || r.type === filter;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.resourceId.toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [all, filter, search]);

  const counts = {
    all: all.length,
    dataform: all.filter((r) => r.type === 'dataform').length,
    process: all.filter((r) => r.type === 'process').length,
    board: all.filter((r) => r.type === 'board').length,
  };

  const syncResource = async (resource: KissflowResource) => {
    setSyncingId(resource.id);
    setSyncError('');

    if (resource.type !== 'process') {
      setSyncError('Field sync via Admin Get-all-items is supported for Processes right now.');
      setSyncingId(null);
      return;
    }

    const adminProcessId =
      (app.appId || '').trim() || resolveProcessIdForAdmin(resource.resourceId);

    const result = await syncFieldsFromAdminItems(app, { processId: adminProcessId });
    if (!result.ok) {
      setSyncError(result.error || 'Sync failed');
      setSyncingId(null);
      return;
    }

    saveDiscoveredFields(app.id, result.fields, result.itemCount, {
      resourceId: resource.resourceId,
      adminProcessId,
    });
    await persistResourceFieldsToServer(
      app,
      resource,
      result.fields,
      result.itemCount,
      adminProcessId,
    );
    setRevision((n) => n + 1);
    onSynced?.();
    setSyncingId(null);
    navigate(`/applications/${app.id}/resources/${resource.id}?tab=fields`);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
          />
        </div>
        <div className="flex items-center bg-background-100 rounded-lg p-0.5">
          {(
            [
              ['all', `All (${counts.all})`],
              ['dataform', `Dataforms (${counts.dataform})`],
              ['process', `Processes (${counts.process})`],
              ['board', `Boards (${counts.board})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                filter === value ? 'bg-white text-foreground-900 shadow-sm' : 'text-foreground-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {syncError && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          {syncError}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((resource) => (
          <div
            key={resource.id}
            onClick={() => navigate(`/applications/${app.id}/resources/${resource.id}`)}
            className="bg-white border border-background-300/60 rounded-xl p-3.5 hover:border-primary-200/60 transition-colors cursor-pointer group"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
                <i className={`${resource.icon} text-foreground-600`}></i>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-foreground-900 font-mono">{resource.name}</h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-background-100 text-foreground-600">
                    {resourceTypeLabel[resource.type]}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize ${statusStyles[resource.status]}`}
                  >
                    {resource.status}
                  </span>
                </div>
                <p className="text-[11px] text-foreground-400 mt-1">
                  {resource.fieldsCount} fields · last sync{' '}
                  {new Date(resource.lastSync).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => navigate(`/applications/${app.id}/resources/${resource.id}`)}
                  className="h-7 px-2.5 rounded-md text-xs font-medium text-primary-700 bg-primary-50 cursor-pointer"
                >
                  View
                </button>
                <button
                  onClick={() => syncResource(resource)}
                  disabled={syncingId === resource.id}
                  title="Call Admin Get-all-items and discover fields"
                  className="h-7 px-2.5 rounded-md text-xs font-medium border border-background-300/60 cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {syncingId === resource.id ? (
                    <span className="w-3 h-3 border-2 border-foreground-300 border-t-foreground-700 rounded-full animate-spin"></span>
                  ) : (
                    <i className="ri-refresh-line"></i>
                  )}
                  Sync
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="bg-white border border-background-300/60 rounded-xl p-10 text-center">
            <p className="text-sm text-foreground-500">No resource IDs registered</p>
            <p className="text-xs text-foreground-400 mt-1">
              Add process, dataform, or board IDs when adding the application
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
