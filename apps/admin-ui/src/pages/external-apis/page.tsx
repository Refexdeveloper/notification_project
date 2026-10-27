import { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAuth } from '@/hooks/AuthContext';
import { apiV1Fetch, isBackendApiMode } from '@/services/backendApi';
import { EXTERNAL_GCP_APIS, type ExternalGcpApi } from '@/lib/externalGcpApis';

type ApiLog = {
  timestamp: string;
  severity: string;
  method: string;
  status: number | null;
  path: string;
  latency: string;
  message: string;
};

function formatWhen(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusClass(status: number | null) {
  if (status == null) return 'text-slate-500';
  if (status >= 500) return 'text-red-700';
  if (status >= 400) return 'text-amber-700';
  return 'text-emerald-700';
}

export default function ExternalApisPage() {
  const backendMode = isBackendApiMode();
  const { isAdmin } = useAuth();
  const [selectedId, setSelectedId] = useState(EXTERNAL_GCP_APIS[0]?.id || '');
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const selected = EXTERNAL_GCP_APIS.find((api) => api.id === selectedId) || EXTERNAL_GCP_APIS[0];

  useEffect(() => {
    if (!backendMode || !isAdmin || !selected) return;
    let cancelled = false;
    setLogsLoading(true);
    setLogsError('');
    void apiV1Fetch<{ logs: ApiLog[] }>(`/external-apis/${selected.id}/logs`).then((res) => {
      if (cancelled) return;
      setLogsLoading(false);
      if (!res.ok) {
        setLogs([]);
        setLogsError(res.error || 'Could not load API logs');
        return;
      }
      setLogs(res.data?.logs || []);
    });
    return () => {
      cancelled = true;
    };
  }, [backendMode, isAdmin, selected?.id]);

  const reloadLogs = () => {
    if (!selected) return;
    setSelectedId(selected.id);
    setLogsLoading(true);
    setLogsError('');
    void apiV1Fetch<{ logs: ApiLog[] }>(`/external-apis/${selected.id}/logs`).then((res) => {
      setLogsLoading(false);
      if (!res.ok) {
        setLogs([]);
        setLogsError(res.error || 'Could not load API logs');
        return;
      }
      setLogs(res.data?.logs || []);
    });
  };

  return (
    <Layout title="External APIs" breadcrumbs={[{ label: 'External APIs' }]}>
      <div className="mx-auto max-w-6xl space-y-4">
        <p className="text-sm text-foreground-600">
          Public GCP APIs used by Kissflow, Refex One, and WhatsApp. API keys are not shown.
          Request logs are the last calls Cloud Run recorded for the selected API.
        </p>

        {!isAdmin && (
          <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-foreground-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Only Admin users can open API logs.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
            {EXTERNAL_GCP_APIS.map((api) => {
              const active = api.id === selected?.id;
              return (
                <button
                  key={api.id}
                  type="button"
                  onClick={() => setSelectedId(api.id)}
                  className={`min-w-[220px] shrink-0 rounded-xl border px-3 py-2.5 text-left lg:min-w-0 lg:w-full ${
                    active
                      ? 'border-[#0F6CBD] bg-[#E8F3FC]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground-900">{api.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-foreground-500">{api.service}</span>
                </button>
              );
            })}
          </div>

          {selected ? <ApiDetail api={selected} /> : null}
        </div>

        {selected?.id === 'keyword-matching' ? (
          <KeywordMatchGuide isAdmin={isAdmin} backendMode={backendMode} />
        ) : null}

        {selected ? (
          <GlassCard className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground-900">Request logs</h2>
                <p className="text-xs text-foreground-500">{selected.service} · newest first · query strings removed</p>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={!isAdmin || logsLoading} onClick={reloadLogs}>
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                Refresh logs
              </Button>
            </div>

            {logsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{logsError}</div>
            )}
            {logsLoading && <p className="text-sm text-foreground-500">Loading logs…</p>}
            {!logsLoading && !logsError && logs.length === 0 && (
              <p className="text-sm text-foreground-500">No request logs for this API yet.</p>
            )}

            {logs.length > 0 && (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="text-[11px] uppercase tracking-wide text-foreground-500">
                      <tr>
                        <th className="px-2 py-2 font-semibold">Time</th>
                        <th className="px-2 py-2 font-semibold">Method</th>
                        <th className="px-2 py-2 font-semibold">Status</th>
                        <th className="px-2 py-2 font-semibold">Path</th>
                        <th className="px-2 py-2 font-semibold">Latency</th>
                        <th className="px-2 py-2 font-semibold">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((row, index) => (
                        <tr key={`${row.timestamp}-${index}`} className="border-t border-slate-100">
                          <td className="whitespace-nowrap px-2 py-2 text-foreground-700">{formatWhen(row.timestamp)}</td>
                          <td className="px-2 py-2 font-mono">{row.method || '—'}</td>
                          <td className={`px-2 py-2 font-semibold ${statusClass(row.status)}`}>{row.status ?? '—'}</td>
                          <td className="px-2 py-2 font-mono">{row.path || '—'}</td>
                          <td className="whitespace-nowrap px-2 py-2">{row.latency || '—'}</td>
                          <td className="max-w-[280px] truncate px-2 py-2 text-foreground-600">{row.message || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 md:hidden">
                  {logs.map((row, index) => (
                    <div key={`${row.timestamp}-m-${index}`} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold">{row.method || '—'} {row.path || ''}</span>
                        <span className={`font-semibold ${statusClass(row.status)}`}>{row.status ?? '—'}</span>
                      </div>
                      <p className="mt-1 text-foreground-500">{formatWhen(row.timestamp)}{row.latency ? ` · ${row.latency}` : ''}</p>
                      {row.message ? <p className="mt-1 break-words text-foreground-700">{row.message}</p> : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </GlassCard>
        ) : null}
      </div>
    </Layout>
  );
}

function ApiDetail({ api }: { api: ExternalGcpApi }) {
  return (
    <GlassCard className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground-900">{api.name}</h2>
        <p className="mt-1 text-sm text-foreground-600">{api.summary}</p>
      </div>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Base URL</dt>
          <dd className="mt-1 break-all font-mono text-xs text-foreground-800">{api.baseUrl}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Cloud Run service</dt>
          <dd className="mt-1 font-mono text-xs text-foreground-800">{api.service}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Auth</dt>
          <dd className="mt-1 text-xs text-foreground-700">{api.auth}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Used by</dt>
          <dd className="mt-1 text-xs text-foreground-700">{api.usedBy}</dd>
        </div>
      </dl>
      {api.docsUrl ? (
        <a href={api.docsUrl} target="_blank" rel="noreferrer" className="inline-flex text-xs font-semibold text-[#0F6CBD] hover:underline">
          Open API docs
        </a>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-foreground-500">
            <tr>
              <th className="px-2 py-2 font-semibold">Method</th>
              <th className="px-2 py-2 font-semibold">Path</th>
              <th className="px-2 py-2 font-semibold">What it does</th>
            </tr>
          </thead>
          <tbody>
            {api.endpoints.map((endpoint) => (
              <tr key={`${endpoint.method}-${endpoint.path}`} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-2 py-2 font-mono font-semibold">{endpoint.method}</td>
                <td className="whitespace-nowrap px-2 py-2 font-mono">{endpoint.path}</td>
                <td className="px-2 py-2 text-foreground-700">{endpoint.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {api.request ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Example request</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">{api.request}</pre>
        </div>
      ) : null}
      {api.response ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Example response</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">{api.response}</pre>
        </div>
      ) : null}
    </GlassCard>
  );
}

type KeywordColumn = { name: string; type: string };
type KeywordTable = { name: string; rowCount: number; note: string; columns: KeywordColumn[] };
type KeywordDb = {
  project: string;
  dataset: string;
  kissflowForm: string;
  kissflowApplication: string;
  tables: KeywordTable[];
  keywords: { sub_type: string; keywords: string }[];
  matrix: {
    entity: string;
    category: string;
    sub_category: string;
    type: string;
    sub_type: string;
    criticality: string;
    turnaround_time_tat: string;
    closure_time: string;
    keywords: string;
    source: string;
  }[];
  outcomes: { predicted_source: string; predicted_status: string; n: string }[];
};

const MESSAGE_STEPS = [
  {
    title: 'The message arrives as mail_body',
    body: 'The only required field is the message text. Refex One chat sends the words the person typed. An email or UNFYD caller can also send subject, from, to, message id, thread id, reply-to, received time, and application. Application defaults to ITSM.',
  },
  {
    title: 'The text is stored, then searched',
    body: 'Each call is written to email_learning_log. raw_email keeps the original message. cleaned_email keeps the copy used for history. The matcher looks for known phrases inside that message text.',
  },
  {
    title: 'Path 1 — a known phrase hits',
    body: 'Phrases live in BigQuery table keywords. One row is one sub-type, and the phrases in that row are separated by commas. If a phrase is found, the API returns SUCCESS, the longest phrase that hit, and a score equal to how many phrases of that winning sub-type were found.',
  },
  {
    title: 'No phrase hit — embeddings, then Gemini',
    body: 'The message is compared with sub_type_embeddings (Gemini embedding model, 768 dimensions, top 8 neighbours). A strong neighbour is similarity 0.82 or higher. Gemini 2.5 Flash can also name an existing sub-type or propose a new one. The confidence bar for applying that suggestion is 0.75.',
  },
  {
    title: 'Path 2 and path 3 save the new sub-type',
    body: 'Path 2 adds the new phrases onto the keyword row. Path 3 creates the sub-type on Kissflow form Live_Approval_Matrix_A00 for entity Refex, with criticality Medium, TAT 120, and closure time 240. The API still returns SUCCESS with that sub-type, so the caller can open a real ticket.',
  },
  {
    title: 'Nothing named',
    body: 'If no phrase hits and the model cannot name a sub-type, status is NO_MATCH and sub_type is Others.',
  },
  {
    title: 'What stays out of the live master',
    body: 'A daily sync copies Kissflow Live_Approval_Matrix_A00 into approval_matrix. It adds missing rows and updates category fields, and it keeps keywords that were added in BigQuery. A separate daily read of Live_IT_Service_Request_A00 (last 24 hours) queues repeated phrases in pending_keywords. Those phrases wait for a person to verify them.',
  },
];

function KeywordMatchGuide({ isAdmin, backendMode }: { isAdmin: boolean; backendMode: boolean }) {
  const [db, setDb] = useState<KeywordDb | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [matrixQuery, setMatrixQuery] = useState('');
  const [openTable, setOpenTable] = useState('keywords');

  const load = () => {
    if (!backendMode || !isAdmin) return;
    setLoading(true);
    setError('');
    void apiV1Fetch<KeywordDb>('/external-apis/keyword-matching/database', {}, { timeoutMs: 40000 }).then((res) => {
      setLoading(false);
      if (!res.ok || !res.data) {
        setError(res.error || 'Could not load the keyword database');
        return;
      }
      setDb(res.data);
    });
  };

  useEffect(() => {
    load();
    // Load once when the keyword panel is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendMode, isAdmin]);

  const keywordNeedle = keywordQuery.trim().toLowerCase();
  const matrixNeedle = matrixQuery.trim().toLowerCase();
  const keywordRows = (db?.keywords || []).filter((row) => {
    if (!keywordNeedle) return true;
    return `${row.sub_type} ${row.keywords}`.toLowerCase().includes(keywordNeedle);
  });
  const matrixRows = (db?.matrix || []).filter((row) => {
    if (!matrixNeedle) return true;
    return Object.values(row).join(' ').toLowerCase().includes(matrixNeedle);
  });

  return (
    <div className="space-y-4">
      <GlassCard className="space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-foreground-900">How the message becomes a sub-type</h2>
        <ol className="space-y-3">
          {MESSAGE_STEPS.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E8F3FC] text-xs font-semibold text-[#0F6CBD]">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground-900">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </GlassCard>

      <GlassCard className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground-900">Database</h2>
            <p className="text-xs text-foreground-500">
              BigQuery {db ? `${db.project}.${db.dataset}` : 'master-diorama-489103-u2.itsm_keywords'}
              {db ? ` · Kissflow ${db.kissflowForm} · ${db.kissflowApplication}` : ''}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={!isAdmin || loading} onClick={load}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh database
          </Button>
        </div>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        {loading && !db ? <p className="text-sm text-foreground-500">Loading tables…</p> : null}

        {db ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {db.tables.map((table) => (
                <button
                  key={table.name}
                  type="button"
                  onClick={() => setOpenTable(table.name)}
                  className={`rounded-xl border px-3 py-2.5 text-left ${
                    openTable === table.name ? 'border-[#0F6CBD] bg-[#E8F3FC]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground-900">{table.name}</span>
                    <span className="text-xs font-semibold tabular-nums text-foreground-700">{table.rowCount.toLocaleString('en-IN')}</span>
                  </span>
                  {table.note ? <span className="mt-1 block text-[11px] leading-snug text-foreground-500">{table.note}</span> : null}
                </button>
              ))}
            </div>
            {db.tables.filter((table) => table.name === openTable).map((table) => (
              <div key={table.name} className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-foreground-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Column</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((column) => (
                      <tr key={column.name} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-mono">{column.name}</td>
                        <td className="px-3 py-1.5 text-foreground-600">{column.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {db.outcomes.length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Stored match results</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {db.outcomes.map((row) => (
                    <span key={`${row.predicted_source}-${row.predicted_status}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-foreground-700">
                      {row.predicted_source || 'blank'} · {row.predicted_status || 'blank'} · {Number(row.n).toLocaleString('en-IN')}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-foreground-900">Keyword master · {keywordRows.length.toLocaleString('en-IN')} rows</p>
                <input
                  value={keywordQuery}
                  onChange={(event) => setKeywordQuery(event.target.value)}
                  placeholder="Search sub-type or phrase"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm sm:max-w-xs"
                />
              </div>
              <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-foreground-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Sub-type</th>
                      <th className="px-3 py-2 font-semibold">Phrases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywordRows.map((row) => (
                      <tr key={row.sub_type} className="border-t border-slate-100 align-top">
                        <td className="w-[220px] px-3 py-2 font-medium text-foreground-900">{row.sub_type}</td>
                        <td className="px-3 py-2 leading-relaxed text-foreground-700">{row.keywords}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-foreground-900">Approval matrix · {matrixRows.length.toLocaleString('en-IN')} rows</p>
                <input
                  value={matrixQuery}
                  onChange={(event) => setMatrixQuery(event.target.value)}
                  placeholder="Search entity, category, or sub-type"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm sm:max-w-xs"
                />
              </div>
              <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-foreground-500">
                    <tr>
                      {['Entity', 'Category', 'Sub-category', 'Type', 'Sub-type', 'Criticality', 'TAT', 'Closure', 'Source', 'Keywords'].map((label) => (
                        <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((row, index) => (
                      <tr key={`${row.sub_type}-${index}`} className="border-t border-slate-100 align-top">
                        <td className="whitespace-nowrap px-3 py-2">{row.entity}</td>
                        <td className="px-3 py-2">{row.category}</td>
                        <td className="px-3 py-2">{row.sub_category}</td>
                        <td className="px-3 py-2">{row.type}</td>
                        <td className="px-3 py-2 font-medium">{row.sub_type}</td>
                        <td className="px-3 py-2">{row.criticality}</td>
                        <td className="px-3 py-2 tabular-nums">{row.turnaround_time_tat}</td>
                        <td className="px-3 py-2 tabular-nums">{row.closure_time}</td>
                        <td className="px-3 py-2">{row.source}</td>
                        <td className="min-w-[240px] px-3 py-2 leading-relaxed text-foreground-700">{row.keywords}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </GlassCard>
    </div>
  );
}
