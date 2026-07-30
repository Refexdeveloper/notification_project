import { useEffect, useMemo, useState } from 'react';
import type { KissflowApplication } from '@/mocks/applications';
import {
  buildCurl,
  buildKissflowUrl,
  getEndpointsForKind,
  type ApiEndpoint,
  type ResourceKind,
} from '@/mocks/connection';
import { resolveProcessIdForAdmin } from '@/services/kissflowClient';

interface ApiExplorerTabProps {
  app: KissflowApplication;
}

interface RegisteredResource {
  kind: ResourceKind;
  id: string;
  label: string;
  icon: string;
}

interface TestResult {
  status: number | string;
  timeMs: number;
  body: string;
  mode: 'live' | 'simulated' | 'error';
  message?: string;
}

export default function ApiExplorerTab({ app }: ApiExplorerTabProps) {
  const host = `https://${app.subdomain}.kissflow.${app.region}`;

  const resources = useMemo<RegisteredResource[]>(() => {
    const list: RegisteredResource[] = [
      {
        kind: 'account',
        id: app.accountId,
        label: `Account · ${app.accountId}`,
        icon: 'ri-building-line',
      },
    ];
    for (const id of app.processIds || []) {
      list.push({ kind: 'process', id, label: id, icon: 'ri-git-branch-line' });
    }
    for (const id of app.dataformIds || []) {
      list.push({ kind: 'dataform', id, label: id, icon: 'ri-survey-line' });
    }
    for (const id of app.boardIds || []) {
      list.push({ kind: 'board', id, label: id, icon: 'ri-kanban-view' });
    }
    for (const id of app.datasetIds || []) {
      list.push({ kind: 'dataset', id, label: id, icon: 'ri-database-2-line' });
    }
    return list;
  }, [app]);

  const [selectedResourceKey, setSelectedResourceKey] = useState(
    () => `${resources[0]?.kind}:${resources[0]?.id}`,
  );
  const selectedResource =
    resources.find((r) => `${r.kind}:${r.id}` === selectedResourceKey) || resources[0];

  const endpoints = useMemo(
    () => (selectedResource ? getEndpointsForKind(selectedResource.kind) : []),
    [selectedResource],
  );

  const [selectedEndpointId, setSelectedEndpointId] = useState(endpoints[0]?.id || '');
  const endpoint =
    endpoints.find((e) => e.id === selectedEndpointId) || endpoints[0] || null;

  const [itemId, setItemId] = useState('ITEM_ID');
  const [body, setBody] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [history, setHistory] = useState<
    { id: string; name: string; resourceId: string; status: string | number; at: string }[]
  >([]);

  useEffect(() => {
    if (!resources.length) return;
    const stillValid = resources.some((r) => `${r.kind}:${r.id}` === selectedResourceKey);
    if (!stillValid) {
      setSelectedResourceKey(`${resources[0].kind}:${resources[0].id}`);
    }
  }, [resources, selectedResourceKey]);

  useEffect(() => {
    if (!endpoints.length) {
      setSelectedEndpointId('');
      return;
    }
    if (!endpoints.some((e) => e.id === selectedEndpointId)) {
      setSelectedEndpointId(endpoints[0].id);
    }
  }, [endpoints, selectedEndpointId]);

  useEffect(() => {
    if (endpoint?.bodyExample) setBody(endpoint.bodyExample);
    else setBody('');
    setResult(null);
  }, [endpoint?.id]);

  const fullUrl = useMemo(() => {
    if (!endpoint || !selectedResource) return '';
    const isAdminProcess =
      selectedResource.kind === 'process' && endpoint.path.includes('/admin/');
    const resourceId =
      selectedResource.kind === 'account'
        ? undefined
        : isAdminProcess
          ? resolveProcessIdForAdmin(selectedResource.id)
          : selectedResource.id;
    return buildKissflowUrl(
      host,
      endpoint.path,
      {
        accountId: app.accountId,
        resourceId,
        itemId,
      },
      endpoint.queryParams,
    );
  }, [endpoint, selectedResource, host, app.accountId, itemId]);

  const curl = useMemo(() => {
    if (!endpoint || !fullUrl) return '';
    return buildCurl(
      endpoint.method,
      fullUrl,
      app.accessKeyId,
      app.accessKeySecret,
      endpoint.method === 'GET' || endpoint.method === 'DELETE' ? undefined : body,
    );
  }, [endpoint, fullUrl, app.accessKeyId, app.accessKeySecret, body]);

  const needsItemId = Boolean(endpoint?.path.includes('{item_id}'));

  const selectResource = (resource: RegisteredResource) => {
    setSelectedResourceKey(`${resource.kind}:${resource.id}`);
    setResult(null);
  };

  const runTest = async () => {
    if (!endpoint || !selectedResource || !fullUrl) return;
    setRunning(true);
    setResult(null);
    const started = performance.now();

    // Route through local Vite proxy to avoid browser CORS
    const pathAndQuery = fullUrl.replace(host, '') || '/';
    const proxyUrl = `/api/kissflow-proxy${pathAndQuery}`;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Kissflow-Host': host,
        'X-Access-Key-Id': app.accessKeyId,
        'X-Access-Key-Secret': app.accessKeySecret,
      };
      const init: RequestInit = { method: endpoint.method, headers };
      if (endpoint.method !== 'GET' && endpoint.method !== 'DELETE' && body.trim()) {
        headers['Content-Type'] = 'application/json';
        init.body = body;
      }

      const res = await fetch(proxyUrl, init);
      const timeMs = Math.round(performance.now() - started);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* keep raw */
      }

      const isOk = res.status >= 200 && res.status < 300;
      const isAdminEndpoint = endpoint.path.includes('/admin');
      let message: string | undefined;
      if (!isOk) {
        if (res.status === 403 && isAdminEndpoint) {
          message =
            '403 Forbidden: Admin APIs need an Admin Access Key. Use "Get list of my items" or "Get list of my tasks" instead — those work with standard keys.';
        } else if (res.status === 403) {
          message =
            '403 Forbidden: this Access Key cannot access this resource. Check account permissions and that the Process/Board/Dataform ID is correct.';
        } else if (res.status === 401) {
          message = '401 Unauthorized: Access Key ID or Secret is invalid.';
        } else if (res.status === 404) {
          message = '404 Not found: Account ID or resource ID may be wrong.';
        } else {
          message = `Kissflow returned HTTP ${res.status}. Check Account ID, resource ID, and access keys.`;
        }
      }
      const next: TestResult = {
        status: res.status,
        timeMs,
        body: pretty || '(empty response)',
        mode: isOk ? 'live' : 'error',
        message,
      };
      setResult(next);
      pushHistory(endpoint, selectedResource.id, res.status);
    } catch (err) {
      const timeMs = Math.round(performance.now() - started);
      setResult({
        status: 'ERR',
        timeMs,
        body: JSON.stringify(
          {
            error: err instanceof Error ? err.message : String(err),
            hint: 'Restart the Vite dev server after proxy changes (npm run dev), then try again.',
            target: fullUrl,
          },
          null,
          2,
        ),
        mode: 'error',
        message: 'Could not reach the local Kissflow proxy. Restart npm run dev and retry.',
      });
      pushHistory(endpoint, selectedResource.id, 'err');
    } finally {
      setRunning(false);
    }
  };

  const pushHistory = (ep: ApiEndpoint, resourceId: string, status: string | number) => {
    setHistory((h) =>
      [
        {
          id: `${Date.now()}`,
          name: ep.name,
          resourceId,
          status,
          at: new Date().toISOString(),
        },
        ...h,
      ].slice(0, 10),
    );
  };

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curl);
    } catch {
      /* ignore */
    }
  };

  const grouped = useMemo(() => {
    const groups: { title: string; kind: ResourceKind; items: RegisteredResource[] }[] = [
      { title: 'Account', kind: 'account', items: [] },
      { title: 'Processes', kind: 'process', items: [] },
      { title: 'Dataforms', kind: 'dataform', items: [] },
      { title: 'Boards', kind: 'board', items: [] },
      { title: 'Datasets', kind: 'dataset', items: [] },
    ];
    for (const r of resources) {
      const g = groups.find((x) => x.kind === r.kind);
      g?.items.push(r);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [resources]);

  if (!resources.length) {
    return (
      <div className="bg-white border border-background-300/60 rounded-xl p-10 text-center">
        <p className="text-sm text-foreground-500">No resources registered on this application</p>
        <p className="text-xs text-foreground-400 mt-1">
          Add process, dataform, or board IDs to test Kissflow APIs
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[260px_220px_1fr] gap-3">
      {/* Registered IDs */}
      <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden h-fit max-h-[70vh] flex flex-col">
        <div className="px-3 py-2.5 border-b border-background-200/70 shrink-0">
          <h3 className="text-xs font-semibold text-foreground-900">Your resources</h3>
          <p className="text-[10px] text-foreground-400 mt-0.5">From Add Application</p>
        </div>
        <div className="p-1.5 space-y-2 overflow-y-auto">
          {grouped.map((group) => (
            <div key={group.kind}>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((r) => {
                  const key = `${r.kind}:${r.id}`;
                  const active = key === selectedResourceKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectResource(r)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg cursor-pointer flex items-center gap-2 ${
                        active ? 'bg-primary-50 ring-1 ring-primary-100' : 'hover:bg-background-50'
                      }`}
                    >
                      <i className={`${r.icon} text-sm ${active ? 'text-primary-600' : 'text-foreground-400'}`}></i>
                      <span className={`text-xs font-mono truncate ${active ? 'text-primary-800 font-medium' : 'text-foreground-700'}`}>
                        {r.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Endpoints for selected resource */}
      <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden h-fit max-h-[70vh] flex flex-col">
        <div className="px-3 py-2.5 border-b border-background-200/70 shrink-0">
          <h3 className="text-xs font-semibold text-foreground-900">APIs</h3>
          <p className="text-[10px] text-foreground-400 mt-0.5 font-mono truncate">
            {selectedResource?.id}
          </p>
        </div>
        <div className="p-1.5 space-y-0.5 overflow-y-auto">
          {endpoints.map((ep) => (
            <button
              key={ep.id}
              type="button"
              onClick={() => {
                setSelectedEndpointId(ep.id);
                setResult(null);
              }}
              className={`w-full text-left px-2.5 py-2 rounded-lg cursor-pointer ${
                endpoint?.id === ep.id ? 'bg-primary-50' : 'hover:bg-background-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <MethodBadge method={ep.method} />
                {ep.path.includes('/admin') && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                    ADMIN
                  </span>
                )}
              </div>
              <span className="text-xs font-medium text-foreground-800 leading-snug block">
                {ep.name}
              </span>
            </button>
          ))}
          {endpoints.length === 0 && (
            <p className="px-2 py-4 text-[11px] text-foreground-400 text-center">No APIs for this type</p>
          )}
        </div>
      </div>

      {/* Request / Test panel */}
      <div className="space-y-3 min-w-0">
        {endpoint && selectedResource ? (
          <>
            <div className="bg-white border border-background-300/60 rounded-xl p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground-900">{endpoint.name}</h3>
                <p className="text-xs text-foreground-500 mt-0.5">{endpoint.description}</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <MethodBadge method={endpoint.method} large />
                <input
                  readOnly
                  value={fullUrl}
                  className="flex-1 min-w-[200px] h-9 px-3 rounded-lg border border-background-300/60 bg-background-50 text-[11px] font-mono text-foreground-700"
                />
                <button
                  type="button"
                  onClick={copyCurl}
                  className="h-9 px-3 rounded-lg border border-background-300/60 text-xs font-medium cursor-pointer whitespace-nowrap hover:bg-background-50"
                >
                  Copy cURL
                </button>
                <button
                  type="button"
                  onClick={runTest}
                  disabled={running || !app.accessKeyId}
                  className="h-9 px-3.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 disabled:opacity-50 cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5"
                >
                  {running ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Testing
                    </>
                  ) : (
                    <>
                      <i className="ri-play-line"></i>
                      Test API
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ParamBlock
                  title="Headers"
                  rows={[
                    ['Accept', 'application/json'],
                    ['X-Access-Key-Id', app.accessKeyId || '<required>'],
                    ['X-Access-Key-Secret', app.accessKeySecret ? '••••••••' : '<required>'],
                  ]}
                />
                <ParamBlock
                  title="Path parameters"
                  rows={[
                    ['account_id', app.accountId],
                    ...(selectedResource.kind !== 'account'
                      ? [[selectedResource.kind === 'dataform' ? 'form / process / board id' : 'resource_id', selectedResource.id] as [string, string]]
                      : []),
                    ...(needsItemId ? [['item_id', itemId] as [string, string]] : []),
                  ]}
                />
              </div>

              {needsItemId && (
                <div>
                  <label className="block text-xs font-medium text-foreground-700 mb-1.5">
                    Item / record / view ID
                  </label>
                  <input
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-background-300/60 text-xs font-mono outline-none focus:border-primary-300"
                    placeholder="Paste Kissflow item _id"
                  />
                </div>
              )}

              {endpoint.queryParams && endpoint.queryParams.length > 0 && (
                <ParamBlock
                  title="Query parameters"
                  rows={endpoint.queryParams.map((q) => [q.name, q.example])}
                />
              )}

              {endpoint.method !== 'GET' && endpoint.method !== 'DELETE' && (
                <div>
                  <label className="block text-xs font-medium text-foreground-700 mb-1.5">
                    Request body
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    className="w-full px-3 py-2 rounded-lg border border-background-300/60 text-[11px] font-mono outline-none focus:border-primary-300 resize-y"
                  />
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-foreground-700 mb-1.5">cURL</p>
                <pre className="text-[11px] font-mono bg-foreground-950 text-foreground-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                  {curl}
                </pre>
              </div>
            </div>

            {(result || history.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-3">
                {result && (
                  <div className="bg-white border border-background-300/60 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          result.mode === 'error'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-accent-50 text-accent-700'
                        }`}
                      >
                        {result.status}
                      </span>
                      <span className="text-xs text-foreground-500">{result.timeMs}ms</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-background-100 text-foreground-500 capitalize">
                        {result.mode === 'live' ? 'Live' : result.mode}
                      </span>
                    </div>
                    {result.message && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 mb-3">
                        {result.message}
                      </p>
                    )}
                    <p className="text-xs font-medium text-foreground-700 mb-1.5">Response</p>
                    <pre className="text-[11px] font-mono bg-background-50 border border-background-200/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-80">
                      {result.body}
                    </pre>
                  </div>
                )}
                <div className="bg-white border border-background-300/60 rounded-xl p-3 h-fit">
                  <p className="text-xs font-semibold text-foreground-900 mb-2">History</p>
                  <div className="space-y-1.5">
                    {history.map((h) => (
                      <div key={h.id} className="text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-foreground-700">{h.name}</span>
                          <span className="text-accent-700 font-medium shrink-0">{h.status}</span>
                        </div>
                        <p className="text-foreground-400 font-mono truncate">{h.resourceId}</p>
                      </div>
                    ))}
                    {history.length === 0 && (
                      <p className="text-[11px] text-foreground-400">No requests yet</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-white border border-background-300/60 rounded-xl p-10 text-center text-sm text-foreground-500">
            Select a resource to load Kissflow APIs
          </div>
        )}
      </div>
    </div>
  );
}

function MethodBadge({
  method,
  large,
}: {
  method: ApiEndpoint['method'];
  large?: boolean;
}) {
  const colors: Record<string, string> = {
    GET: 'text-accent-700 bg-accent-50',
    POST: 'text-primary-700 bg-primary-50',
    PUT: 'text-amber-700 bg-amber-50',
    PATCH: 'text-secondary-700 bg-secondary-50',
    DELETE: 'text-red-700 bg-red-50',
  };
  return (
    <span
      className={`${large ? 'text-[10px] px-2 py-1' : 'text-[9px] px-1.5 py-0.5'} font-bold rounded ${colors[method]}`}
    >
      {method}
    </span>
  );
}

function ParamBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground-700 mb-1.5">{title}</p>
      <div className="rounded-lg border border-background-200/70 overflow-hidden">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[1fr_1.2fr] text-xs border-b border-background-100 last:border-0">
            <div className="px-2.5 py-1.5 font-mono text-foreground-600 bg-background-50 truncate">{k}</div>
            <div className="px-2.5 py-1.5 font-mono text-foreground-800 truncate" title={v}>
              {v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
