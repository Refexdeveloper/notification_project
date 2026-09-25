'use strict';

/**
 * Project Management portfolio KPIs from record rows.
 * Must stay aligned with:
 *   services/engagement-pipeline/scripts/count-pm-portfolio-kpis.js
 *   apps/admin-ui/src/lib/appDashboardClientFilter.ts countPmPortfolio
 *
 * Tasks     = process_id contains Project_Sub_Task
 * Sub-tasks = process_id contains Sub_Task_Process and not Project_Sub_Task
 * Individual = tasks with no Project ID
 * Projects   = distinct Project ID on tasks
 *   In progress = at least one pending/open task
 *   Completed   = no pending and at least one completed
 */

function scalarLookup(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return String(value).trim();
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t || t === '—' || t === '-') return '';
    if (t[0] === '{') {
      try {
        return scalarLookup(JSON.parse(t));
      } catch {
        return '';
      }
    }
    return t;
  }
  if (Array.isArray(value)) return scalarLookup(value[0]);
  if (typeof value === 'object') {
    return scalarLookup(
      value.Project_ID
      || value._id
      || value._item_id
      || value.Project_Name
      || value.Name
      || value.name
      || value.v,
    );
  }
  return '';
}

function projectKeyFromRaw(raw) {
  const hidden = String(raw?.Project_ID_Hidden || raw?.Project_ID_Details || '').trim();
  if (hidden) return hidden;
  const fromObj = scalarLookup(raw?.Project_ID);
  if (fromObj) return fromObj;
  const name = String(raw?.Project_Name || raw?.Project || '').trim();
  if (name && name[0] !== '{') return name;
  return '';
}

function isPmTaskProcess(processId) {
  return /project_sub_task/i.test(String(processId || ''));
}

function isPmSubtaskProcess(processId) {
  const pid = String(processId || '');
  return /sub_task_process/i.test(pid) && !/project_sub_task/i.test(pid);
}

function recordStatusBucket(row) {
  const s = String(row?.status || row?.status_bucket || '').toLowerCase();
  if (s === 'closed' || s === 'completed' || s === 'done' || s === 'complete') return 'closed';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'withdrawn') return 'rejected';
  return 'open';
}

function recordProjectKey(row) {
  return String(row?.project_id || row?.project_key || '').trim();
}

function emptyPmPortfolio() {
  return {
    projects_total: 0,
    projects_open: 0,
    projects_closed: 0,
    tasks_total: 0,
    tasks_open: 0,
    tasks_closed: 0,
    linked_tasks: 0,
    individual_total: 0,
    individual_open: 0,
    individual_closed: 0,
    subtasks_total: 0,
    subtasks_open: 0,
    subtasks_closed: 0,
  };
}

function buildPmPortfolioFromRecords(records) {
  const out = emptyPmPortfolio();
  const projectMap = new Map();

  for (const row of records || []) {
    const pid = String(row?.process_id || '');
    const bucket = recordStatusBucket(row);
    if (isPmTaskProcess(pid)) {
      out.tasks_total += 1;
      if (bucket === 'open') out.tasks_open += 1;
      else if (bucket === 'closed') out.tasks_closed += 1;
      const key = recordProjectKey(row);
      if (key) {
        out.linked_tasks += 1;
        const entry = projectMap.get(key) || { hasOpen: false, hasClosed: false };
        if (bucket === 'open') entry.hasOpen = true;
        if (bucket === 'closed') entry.hasClosed = true;
        projectMap.set(key, entry);
      } else {
        out.individual_total += 1;
        if (bucket === 'open') out.individual_open += 1;
        else if (bucket === 'closed') out.individual_closed += 1;
      }
    } else if (isPmSubtaskProcess(pid)) {
      out.subtasks_total += 1;
      if (bucket === 'open') out.subtasks_open += 1;
      else if (bucket === 'closed') out.subtasks_closed += 1;
    }
  }

  out.projects_total = projectMap.size;
  for (const entry of projectMap.values()) {
    if (entry.hasOpen) out.projects_open += 1;
    else if (entry.hasClosed) out.projects_closed += 1;
  }
  return out;
}

/** SQL expression for Kissflow Project ID (object or string). Alias default `i`. */
function projectKeySql(alias = 'i') {
  const p = `${alias}.source_payload`;
  return `NULLIF(trim(COALESCE(
    NULLIF(trim(${p}->>'Project_ID_Hidden'), ''),
    NULLIF(trim(${p}->>'Project_ID_Details'), ''),
    CASE
      WHEN jsonb_typeof(${p}->'Project_ID') = 'object' THEN COALESCE(
        NULLIF(trim(${p}->'Project_ID'->>'Project_ID'), ''),
        NULLIF(trim(${p}->'Project_ID'->>'_id'), ''),
        NULLIF(trim(${p}->'Project_ID'->>'_item_id'), ''),
        NULLIF(trim(${p}->'Project_ID'->>'Project_Name'), ''),
        NULLIF(trim(${p}->'Project_ID'->>'Name'), '')
      )
      ELSE NULLIF(trim(${p}->>'Project_ID'), '')
    END,
    NULLIF(trim(${p}->>'Project_Name'), ''),
    CASE
      WHEN jsonb_typeof(${p}->'Project') = 'object'
        THEN NULLIF(trim(COALESCE(${p}->'Project'->>'Name', ${p}->'Project'->>'Project_Name')), '')
      ELSE NULLIF(trim(${p}->>'Project'), '')
    END
  )), '')`;
}

module.exports = {
  projectKeyFromRaw,
  isPmTaskProcess,
  isPmSubtaskProcess,
  recordStatusBucket,
  recordProjectKey,
  emptyPmPortfolio,
  buildPmPortfolioFromRecords,
  projectKeySql,
};
