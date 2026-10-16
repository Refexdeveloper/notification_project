/**
 * Solar Operation vs Finance by workflow step (not department / cost center).
 *
 * Start → HO Review → VP Approval = Operation
 * BU Approval onward (Finance Processing → Completed) = Finance
 * After BU Approval finishes, the request is in finance.
 *
 * Operation Closed = moved to a finance step (not process Completed).
 * Rejected counts use the last real workflow step in `_current_context`
 * (Kissflow has no "Rejected" step).
 *
 * Keep in sync with services/backend-api/src/lib/dashboardDisplay.js
 * and engagement-pipeline count-solar-pack-kpis.js (scheduled HTML).
 */

export type SolarCategory = 'Operation' | 'Finance';

export type SolarPackCounts = {
  open: number;
  closed: number;
  rejected: number;
};

function stringifyKfValue(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (Array.isArray(val)) {
    return val.map(stringifyKfValue).filter(Boolean).join(', ');
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.Name != null) return String(obj.Name).trim();
    if (obj.name != null) return String(obj.name).trim();
    if (obj.Value != null) return stringifyKfValue(obj.Value);
    if (obj.value != null) return stringifyKfValue(obj.value);
  }
  return '';
}

export function normalizeSolarStep(step: string): string {
  return String(step || '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kissflow process status labels — not workflow steps. */
export function isSolarStatusLabel(step?: string | null): boolean {
  const s = normalizeSolarStep(step || '');
  return (
    s === 'inprogress'
    || s === 'in progress'
    || s === 'completed'
    || s === 'rejected'
    || s === 'withdrawn'
    || s === 'closed'
    || s === 'open'
    || s === 'pending'
    || s === 'draft'
    || s === 'done'
  );
}

function looksLikeKissflowInstanceId(text: string): boolean {
  const s = String(text || '').trim();
  return /^[A-Za-z]{2}[\w-]{6,}$/.test(s) && !/\s/.test(s);
}

function pickSolarContextStep(payload?: Record<string, unknown> | null): string {
  const ctx = payload?._current_context;
  const list = Array.isArray(ctx)
    ? ctx
    : ctx && typeof ctx === 'object'
      ? [ctx]
      : [];
  const usable = (entry: unknown): string => {
    if (!entry || typeof entry !== 'object') return '';
    const step = stringifyKfValue((entry as Record<string, unknown>)._context_current_step);
    if (!step || isSolarStatusLabel(step) || looksLikeKissflowInstanceId(step)) return '';
    return step;
  };
  const rejected = list.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const status = stringifyKfValue((entry as Record<string, unknown>)._status).toLowerCase();
    return (status.includes('reject') || status.includes('withdraw')) && Boolean(usable(entry));
  });
  if (rejected) return usable(rejected);
  for (const entry of list) {
    const step = usable(entry);
    if (step) return step;
  }
  return '';
}

function pickSolarStep(
  payload?: Record<string, unknown> | null,
  currentStep?: string | null,
): string {
  const candidates = [
    payload?._current_step,
    payload?.Current_Step,
    payload?._activity_name,
    pickSolarContextStep(payload),
    payload?.Step,
    currentStep,
    payload?.current_step,
  ];
  for (const candidate of candidates) {
    const text = stringifyKfValue(candidate);
    if (text && !isSolarStatusLabel(text) && !looksLikeKissflowInstanceId(text)) return text;
  }
  return '';
}

/** Start / HO Review / VP Approval — still operations. */
export function isSolarOperationStep(step?: string | null): boolean {
  const s = normalizeSolarStep(step || '');
  if (!s || isSolarStatusLabel(s)) return false;
  return s === 'start' || s === 'ho review' || s === 'vp approval';
}

/** BU Approval and later (Finance Processing → Completed). */
export function isSolarFinanceStep(step?: string | null): boolean {
  const s = normalizeSolarStep(step || '');
  if (!s || isSolarStatusLabel(s)) return false;
  return (
    s === 'bu approval'
    || s === 'bu approver'
    || /finance\s*process/.test(s)
    || s === 'completed'
    || s === 'complete'
    || /\bpayment\b/.test(s)
    || /disburs/.test(s)
    || /\bsettlement\b/.test(s)
    || /\bsettled\b/.test(s)
  );
}

function processLooksClosed(payload?: Record<string, unknown> | null, statusHint?: string | null): boolean {
  const status = normalizeSolarStep(
    stringifyKfValue(statusHint)
    || stringifyKfValue(payload?._status)
    || stringifyKfValue(payload?.Status)
    || stringifyKfValue(payload?.process_status),
  );
  return status === 'completed' || status === 'complete' || status === 'closed' || status === 'done';
}

export function classifySolarCategory(
  payload?: Record<string, unknown> | null,
  currentStep?: string | null,
  statusHint?: string | null,
): SolarCategory {
  const step = pickSolarStep(payload, currentStep);
  if (isSolarFinanceStep(step)) return 'Finance';
  if (isSolarOperationStep(step)) return 'Operation';
  if (processLooksClosed(payload, statusHint) && !isSolarOperationStep(step)) return 'Finance';
  return 'Operation';
}

export function classifySolarCategoryFromRow(row: {
  current_step?: string | null;
  status?: string | null;
  status_raw?: string | null;
  source_payload?: Record<string, unknown> | null;
}): SolarCategory {
  return classifySolarCategory(
    row?.source_payload || null,
    row?.current_step,
    row?.status_raw || row?.status,
  );
}

function solarStatusBucket(row: { status?: string | null; status_raw?: string | null }): 'open' | 'closed' | 'rejected' {
  const status = String(row?.status || '').toLowerCase();
  const raw = String(row?.status_raw || '').toLowerCase();
  if (status === 'rejected' || raw.includes('reject') || raw.includes('withdraw')) return 'rejected';
  if (status === 'closed' || status === 'completed' || raw === 'completed' || raw === 'closed') return 'closed';
  return 'open';
}

/**
 * Operation Closed = reached BU Approval / Finance (left operations).
 * Rejected stays on the last real step (HO Review vs BU Approval).
 */
export function solarPackCountsFromRecords(
  records: Array<{
    current_step?: string | null;
    status?: string | null;
    status_raw?: string | null;
    source_payload?: Record<string, unknown> | null;
  }>,
): { operation: SolarPackCounts; finance: SolarPackCounts } {
  const operation: SolarPackCounts = { open: 0, closed: 0, rejected: 0 };
  const finance: SolarPackCounts = { open: 0, closed: 0, rejected: 0 };
  for (const row of records || []) {
    const cat = classifySolarCategoryFromRow(row);
    const bucket = solarStatusBucket(row);
    if (cat === 'Finance') {
      finance[bucket] += 1;
    } else if (bucket === 'rejected') {
      operation.rejected += 1;
    } else {
      operation.open += 1;
    }
  }
  operation.closed = finance.open + finance.closed + finance.rejected;
  return { operation, finance };
}

export function solarRowMatchesPack(
  row: {
    current_step?: string | null;
    status?: string | null;
    status_raw?: string | null;
    source_payload?: Record<string, unknown> | null;
  },
  pack: 'operation' | 'finance',
  metric: 'open' | 'closed' | 'rejected',
): boolean {
  const cat = classifySolarCategoryFromRow(row);
  const bucket = solarStatusBucket(row);
  if (pack === 'operation' && metric === 'closed') return cat === 'Finance';
  if (pack === 'operation') return cat === 'Operation' && bucket === metric;
  return cat === 'Finance' && bucket === metric;
}
