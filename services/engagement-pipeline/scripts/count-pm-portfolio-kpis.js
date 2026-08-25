#!/usr/bin/env node
'use strict';

/**
 * Live PM portfolio KPIs from Kissflow:
 *   Projects (derived from linked tasks + optional board)
 *   Tasks (Project_Sub_Task_A01) — all / pending / completed
 *   Individual tasks — tasks with no Project_ID link
 *   Sub-tasks (Sub_Task_Process_A00)
 *
 * Env: KISSFLOW_ACCOUNT_ID, KISSFLOW_KEY, KISSFLOW_SECRET
 * Optional: PM_TASK_PROCESS_ID, PM_SUBTASK_PROCESS_ID, PM_PROJECT_BOARD_ID
 */
const https = require('https');

const host = (process.env.KISSFLOW_HOST || 'refexgroup.kissflow.com').replace(/^https?:\/\//, '');
const accountId = process.env.KISSFLOW_ACCOUNT_ID || '';
const keyId = process.env.KISSFLOW_KEY || process.env.KISSFLOW_KEY_ID || '';
const keySecret = process.env.KISSFLOW_SECRET || '';
const TASK_PROCESS = process.env.PM_TASK_PROCESS_ID || process.env.PROCESS_ID || 'Project_Sub_Task_A01';
const SUBTASK_PROCESS = process.env.PM_SUBTASK_PROCESS_ID || 'Sub_Task_Process_A00';
const PROJECT_BOARD = process.env.PM_PROJECT_BOARD_ID || 'Project_Management_A01';
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

function httpsGetJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'GET',
        headers: {
          'X-Access-Key-Id': keyId,
          'X-Access-Key-Secret': keySecret,
          Accept: 'application/json',
        },
        timeout: 90000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Kissflow HTTP ${res.statusCode} for ${path}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${path}`));
    });
    req.end();
  });
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Items)) return payload.Items;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function fetchProcessItems(processId) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const path = `/process/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(processId)}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=false`;
    const payload = await httpsGetJson(path);
    const batch = extractArray(payload);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchProjectBoardCount() {
  try {
    const path = `/project/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(PROJECT_BOARD)}/item?page_number=1&page_size=${PAGE_SIZE}&apply_preference=false`;
    const payload = await httpsGetJson(path);
    const batch = extractArray(payload);
    // If first page full, keep paging
    let total = batch.length;
    if (batch.length === PAGE_SIZE) {
      for (let page = 2; page <= MAX_PAGES; page += 1) {
        const p = `/project/2/${encodeURIComponent(accountId)}/admin/${encodeURIComponent(PROJECT_BOARD)}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=false`;
        const more = extractArray(await httpsGetJson(p));
        total += more.length;
        if (more.length < PAGE_SIZE) break;
      }
    }
    return total;
  } catch {
    return null;
  }
}

function isCompleted(raw) {
  const status = String(raw?._status || raw?.Task_Status || raw?.TStatus || '').toLowerCase();
  return (
    status === 'completed' ||
    status === 'complete' ||
    status === 'closed' ||
    status === 'done'
  );
}

function isPending(raw) {
  if (isCompleted(raw)) return false;
  const status = String(raw?._status || raw?.Task_Status || raw?.TStatus || '').toLowerCase();
  if (status === 'withdrawn' || status === 'rejected' || status === 'cancelled' || status === 'canceled') {
    return false;
  }
  return true; // InProgress / Open / blank treated as open work
}

function projectKey(raw) {
  const hidden = String(raw?.Project_ID_Hidden || raw?.Project_ID_Details || '').trim();
  if (hidden) return hidden;
  const obj = raw?.Project_ID;
  if (obj && typeof obj === 'object') {
    const id = obj.Project_ID || obj._id || obj._item_id || obj.Project_Name;
    if (id) return String(id).trim();
  }
  const name = String(raw?.Project_Name || raw?.Project || '').trim();
  return name || '';
}

function bucketCounts(items) {
  let total = items.length;
  let pending = 0;
  let completed = 0;
  for (const it of items) {
    if (isCompleted(it)) completed += 1;
    else if (isPending(it)) pending += 1;
  }
  return { total, pending, completed };
}

async function main() {
  if (!accountId || !keyId || !keySecret) {
    console.error('Missing KISSFLOW creds');
    process.exit(2);
  }

  const [tasks, subtasks, boardCount] = await Promise.all([
    fetchProcessItems(TASK_PROCESS),
    fetchProcessItems(SUBTASK_PROCESS).catch(() => []),
    fetchProjectBoardCount(),
  ]);

  const linked = [];
  const individual = [];
  const projectMap = new Map(); // key -> { hasPending, hasCompleted, onlyCompleted }

  for (const t of tasks) {
    const key = projectKey(t);
    if (key) {
      linked.push(t);
      const entry = projectMap.get(key) || { hasPending: false, hasCompleted: false };
      if (isPending(t)) entry.hasPending = true;
      if (isCompleted(t)) entry.hasCompleted = true;
      projectMap.set(key, entry);
    } else {
      individual.push(t);
    }
  }

  let openProjects = 0;
  let completedProjects = 0;
  for (const entry of projectMap.values()) {
    if (entry.hasPending) openProjects += 1;
    else if (entry.hasCompleted) completedProjects += 1;
  }
  const derivedProjectTotal = projectMap.size;
  const totalProjects = boardCount != null && boardCount > 0 ? boardCount : derivedProjectTotal;

  const taskBuckets = bucketCounts(tasks);
  const individualBuckets = bucketCounts(individual);
  const linkedBuckets = bucketCounts(linked);
  const subBuckets = bucketCounts(subtasks);

  process.stdout.write(
    JSON.stringify({
      total_projects: totalProjects,
      open_projects: openProjects,
      completed_projects: completedProjects,
      projects_source: boardCount != null && boardCount > 0 ? 'board' : 'derived_from_tasks',
      total_tasks: taskBuckets.total,
      pending_tasks: taskBuckets.pending,
      completed_tasks: taskBuckets.completed,
      linked_tasks: linkedBuckets.total,
      linked_pending: linkedBuckets.pending,
      linked_completed: linkedBuckets.completed,
      individual_tasks: individualBuckets.total,
      individual_pending: individualBuckets.pending,
      individual_completed: individualBuckets.completed,
      total_subtasks: subBuckets.total,
      pending_subtasks: subBuckets.pending,
      completed_subtasks: subBuckets.completed,
      task_process: TASK_PROCESS,
      subtask_process: SUBTASK_PROCESS,
      project_board: PROJECT_BOARD,
    }),
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
