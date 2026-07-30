import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import {
  getApplicationById,
  getFieldsForResource,
  saveDiscoveredFields,
} from '@/mocks/applications';
import { getResourceById, resourceTypeLabel } from '@/mocks/resources';
import { buildResourcesFromApp } from '@/pages/applications/detail/utils/buildResources';
import { notificationVariables } from '@/mocks/dataforms';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import { getSchedulersByAppId } from '@/stores/reportSchedulers';
import { getHistoryByAppId } from '@/mocks/executions';
import { resolveProcessIdForAdmin } from '@/services/kissflowClient';
import { syncFieldsFromAdminItems } from '@/services/fieldDiscovery';
import {
  fetchResourceFieldsFromServer,
  persistResourceFieldsToServer,
} from '@/services/resourceFieldSync';

const TABS = ['overview', 'fields', 'templates', 'schedulers', 'history', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function ResourceWorkspacePage() {
  const { id, resourceId } = useParams<{ id: string; resourceId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fieldSearch, setFieldSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  const app = useMemo(() => {
    void revision;
    return id ? getApplicationById(id) : undefined;
  }, [id, revision]);

  const resource =
    getResourceById(resourceId || '') ||
    (app ? buildResourcesFromApp(app).find((r) => r.id === resourceId) : undefined);

  const fieldSync = app && resource ? getFieldsForResource(app, resource.resourceId) : undefined;
  const discoveredFields = fieldSync?.fields || [];

  const activeTab = TABS.includes(searchParams.get('tab') as Tab)
    ? (searchParams.get('tab') as Tab)
    : 'overview';

  const setTab = (tab: Tab) => setSearchParams({ tab }, { replace: true });

  const backPath = app ? `/applications/${app.id}?tab=resources` : '/applications';

  useEffect(() => {
    if (!app || !resource) return;
    let cancelled = false;

    (async () => {
      const res = await fetchResourceFieldsFromServer(app.id, resource.resourceId, resource.type);
      if (cancelled || !res.ok || !res.data.fields?.length) return;

      saveDiscoveredFields(app.id, res.data.fields, res.data.resource?.item_count || 0, {
        resourceId: resource.resourceId,
        adminProcessId: res.data.resource?.admin_process_id,
      });
      setRevision((n) => n + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [app?.id, resource?.resourceId, resource?.type]);

  const filteredFields = useMemo(() => {
    const q = fieldSearch.toLowerCase();
    if (!q) return discoveredFields;
    return discoveredFields.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q),
    );
  }, [discoveredFields, fieldSearch]);

  const insertChip = async (variable: string) => {
    try {
      await navigator.clipboard.writeText(variable);
      setCopied(variable);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied(variable);
      setTimeout(() => setCopied(null), 1200);
    }
  };

  const runSync = async () => {
    if (!app || !resource) return;
    setSyncing(true);
    setSyncError('');
    setSyncMessage('');

    if (resource.type !== 'process') {
      setSyncError('Admin Get-all-items field sync is supported for Processes.');
      setSyncing(false);
      return;
    }

    const adminProcessId =
      (app.appId || '').trim() || resolveProcessIdForAdmin(resource.resourceId);

    const result = await syncFieldsFromAdminItems(app, { processId: adminProcessId });
    if (!result.ok) {
      setSyncError(result.error || 'Sync failed');
      setSyncing(false);
      return;
    }

    saveDiscoveredFields(app.id, result.fields, result.itemCount, {
      resourceId: resource.resourceId,
      adminProcessId,
    });

    const dbRes = await persistResourceFieldsToServer(
      app,
      resource,
      result.fields,
      result.itemCount,
      adminProcessId,
    );

    const dbNote = dbRes.ok
      ? ` · saved ${dbRes.data.fieldCount ?? result.fields.length} fields to database`
      : ' · database save skipped (sign in or check API)';

    setSyncMessage(
      `Synced ${result.fields.length} fields via admin/${adminProcessId}` +
        (result.itemCount ? ` · ${result.itemCount} items` : '') +
        dbNote,
    );
    setRevision((n) => n + 1);
    setTab('fields');
    setSyncing(false);
  };

  if (!app || !resource) {
    return (
      <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Not found' }]}>
        <div className="text-center py-16">
          <p className="text-sm font-medium text-foreground-500 mb-3">Resource not found</p>
          <Button variant="primary" size="sm" onClick={() => navigate('/applications')}>
            Back to applications
          </Button>
        </div>
      </Layout>
    );
  }

  const relatedTemplates = getTemplatesByAppId(app.id);
  const relatedSchedulers = getSchedulersByAppId(app.id);
  const history = getHistoryByAppId(app.id);
  const fieldsCount = discoveredFields.length || resource.fieldsCount;
  const lastSync = fieldSync?.syncedAt || resource.lastSync;

  return (
    <Layout
      breadcrumbs={[
        { label: 'Applications', path: '/applications' },
        { label: app.displayName || app.name, path: backPath },
        { label: resource.name },
      ]}
    >
      <div className="mb-5 flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(backPath)}
            leftIcon={<ArrowLeft className="w-4 h-4" />}
            className="shrink-0 mt-0.5"
          >
            Back
          </Button>
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
              <i className={`${resource.icon} text-primary-600 text-lg`}></i>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-heading font-semibold text-foreground-950 truncate">
                  {resource.name}
                </h1>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-background-100 text-foreground-600">
                  {resourceTypeLabel[resource.type]}
                </span>
              </div>
              <p className="text-xs text-foreground-400 font-mono mt-0.5 truncate">
                {resource.resourceId}
                {app.appId ? ` · admin App ID ${app.appId}` : ''}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap lg:justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={runSync}
            disabled={syncing}
            leftIcon={
              syncing ? (
                <span className="w-3.5 h-3.5 border-2 border-foreground-300 border-t-foreground-700 rounded-full animate-spin" />
              ) : (
                <i className="ri-refresh-line text-sm" />
              )
            }
          >
            Sync
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/templates')}
            leftIcon={<i className="ri-mail-add-line text-sm" />}
          >
            New Notification
          </Button>
        </div>
      </div>

      {(syncError || syncMessage) && (
        <div
          className={`mb-4 px-3 py-2 rounded-lg text-xs ${
            syncError
              ? 'bg-red-50 border border-red-100 text-red-700'
              : 'bg-accent-50 border border-accent-100 text-accent-800'
          }`}
        >
          {syncError || syncMessage}
        </div>
      )}

      <div className="flex items-center gap-0.5 bg-background-100 rounded-xl p-1 w-fit overflow-x-auto mb-5">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setTab(tab)}
            className={`h-8 px-3 rounded-lg text-xs font-medium capitalize cursor-pointer whitespace-nowrap ${
              activeTab === tab ? 'bg-white shadow-sm text-foreground-900' : 'text-foreground-500'
            }`}
          >
            {tab}
            {tab === 'fields' && fieldsCount > 0 ? ` (${fieldsCount})` : ''}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="max-w-4xl space-y-3">
          <div className="bg-white border border-background-300/60 rounded-xl p-4">
            <p className="text-sm text-foreground-700">{resource.description}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              <MiniStat label="Fields" value={fieldsCount} />
              <MiniStat label="Templates" value={resource.templatesCount} />
              <MiniStat label="Schedulers" value={resource.schedulersCount} />
              <MiniStat label="Status" value={resource.status} />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={runSync}
              disabled={syncing}
              className="mt-4"
              leftIcon={
                syncing ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <i className="ri-refresh-line" />
                )
              }
            >
              {syncing ? 'Syncing fields…' : 'Sync fields from Kissflow'}
            </Button>
            <p className="text-[11px] text-foreground-400 mt-2 font-mono break-all">
              GET /process/2/{app.accountId}/admin/
              {(app.appId || '').trim() || resolveProcessIdForAdmin(resource.resourceId)}
              /item?page_number=1&page_size=1000&apply_preference=1
            </p>
          </div>
          <div className="bg-white border border-background-300/60 rounded-xl p-4 text-xs space-y-2">
            <Row label="Owner" value={resource.owner} />
            <Row label="Type" value={resourceTypeLabel[resource.type]} />
            <Row label="Last sync" value={new Date(lastSync).toLocaleString()} />
            {fieldSync?.adminProcessId && (
              <Row label="Admin process ID used" value={fieldSync.adminProcessId} />
            )}
          </div>
        </div>
      )}

      {activeTab === 'fields' && (
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
              <input
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                placeholder="Search fields..."
                className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
              />
            </div>
            <div className="flex items-center gap-2">
              {copied && (
                <span className="text-xs text-accent-700 font-medium">Copied {copied}</span>
              )}
              <Button variant="secondary" size="sm" onClick={runSync} disabled={syncing}>
                Sync
              </Button>
            </div>
          </div>

          {filteredFields.length === 0 ? (
            <div className="bg-white border border-background-300/60 rounded-xl px-4 py-12 text-center">
              <div className="w-10 h-10 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-2">
                <i className="ri-input-field text-foreground-300"></i>
              </div>
              <p className="text-sm text-foreground-500 mb-1">No fields yet</p>
              <p className="text-xs text-foreground-400 mb-4">
                Click Sync to call Admin Get-all-items and discover fields from Kissflow.
              </p>
              <Button variant="primary" size="sm" onClick={runSync} disabled={syncing}>
                Sync fields
              </Button>
            </div>
          ) : (
            <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-background-100 flex items-center gap-2">
                <i className="ri-input-field text-foreground-500 text-sm"></i>
                <h3 className="text-xs font-semibold text-foreground-800">Kissflow fields</h3>
                <span className="text-[10px] text-foreground-400 ml-auto">{filteredFields.length}</span>
              </div>
              <div className="p-2 flex flex-wrap gap-1.5">
                {filteredFields.map((field) => {
                  const variable = `{{${field.name}}}`;
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => insertChip(variable)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-background-200/70 bg-background-50 hover:bg-primary-50 hover:border-primary-200 text-xs cursor-pointer transition-colors"
                      title={field.sample ? `Sample: ${field.sample}` : 'Click to copy variable'}
                    >
                      <span className="font-medium text-foreground-800 font-mono">{field.name}</span>
                      <span className="text-[10px] text-foreground-400 bg-white px-1 rounded">
                        {field.type}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 bg-white border border-background-300/60 rounded-xl p-3">
            <p className="text-xs font-medium text-foreground-700 mb-2">
              Common notification variables
            </p>
            <div className="flex flex-wrap gap-1.5">
              {notificationVariables.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => insertChip(v.variable)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium cursor-pointer hover:bg-primary-100"
                >
                  <i className={`${v.icon} text-[10px]`}></i>
                  {v.variable}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="max-w-3xl space-y-2">
          {relatedTemplates.length === 0 ? (
            <div className="bg-white border border-background-300/60 rounded-xl px-4 py-10 text-center text-sm text-foreground-500">
              No templates yet for this app
            </div>
          ) : (
            relatedTemplates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => navigate(`/templates/${tpl.id}`)}
                className="w-full bg-white border border-background-300/60 rounded-xl p-3.5 text-left hover:border-primary-200 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{tpl.name}</p>
                    <p className="text-xs text-foreground-500 mt-0.5">{tpl.subject}</p>
                  </div>
                  <span className="text-[10px] capitalize px-1.5 py-0.5 rounded bg-background-100 text-foreground-600">
                    {tpl.status}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {activeTab === 'schedulers' && (
        <div className="max-w-3xl space-y-2">
          {relatedSchedulers.length === 0 ? (
            <div className="bg-white border border-background-300/60 rounded-xl px-4 py-10 text-center text-sm text-foreground-500">
              No schedules yet for this app
            </div>
          ) : (
            relatedSchedulers.map((sch) => (
              <button
                key={sch.id}
                type="button"
                onClick={() => navigate(`/schedulers/${sch.id}`)}
                className="w-full bg-white border border-background-300/60 rounded-xl p-3.5 text-left hover:border-primary-200 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{sch.name}</p>
                    <p className="text-xs text-foreground-500 mt-0.5">{sch.description}</p>
                  </div>
                  <span className="text-[10px] capitalize px-1.5 py-0.5 rounded bg-accent-50 text-accent-700">
                    {sch.status}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="max-w-3xl bg-white border border-background-300/60 rounded-xl overflow-hidden">
          {history.map((h) => (
            <div
              key={h.id}
              className="px-4 py-3 border-b border-background-100 last:border-0 flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground-800 truncate">{h.subject}</p>
                <p className="text-[11px] text-foreground-400">{h.recipient}</p>
              </div>
              <span className="text-[10px] capitalize px-1.5 py-0.5 rounded bg-background-100 text-foreground-600">
                {h.status}
              </span>
            </div>
          ))}
          {history.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-foreground-500">
              No history for this resource
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="max-w-xl bg-white border border-background-300/60 rounded-xl p-4 space-y-3">
          <Field label="Resource display name">
            <input
              defaultValue={resource.name}
              className="w-full h-9 px-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
            />
          </Field>
          <Field label="Admin App ID used for sync">
            <input
              readOnly
              value={(app.appId || '').trim() || resolveProcessIdForAdmin(resource.resourceId)}
              className="w-full h-9 px-3 text-sm font-mono rounded-lg border border-background-300/60 bg-background-50 outline-none"
            />
            <p className="text-[11px] text-foreground-400 mt-1">
              Change App ID under Application Settings. For this process,{' '}
              <code className="font-mono">Lead_Trcaker_A00</code> maps to{' '}
              <code className="font-mono">Lead_tracker_1_A00</code> when App ID is empty.
            </p>
          </Field>
          <Button variant="primary" size="sm" onClick={runSync} disabled={syncing}>
            Sync fields now
          </Button>
        </div>
      )}
    </Layout>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-background-50 border border-background-200/70 p-2.5">
      <p className="text-[10px] text-foreground-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground-900 mt-0.5 capitalize">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-foreground-500">{label}</span>
      <span className="text-foreground-800 font-medium font-mono text-right break-all">{value}</span>
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
