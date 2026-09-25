'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  projectKeyFromRaw,
  isPmTaskProcess,
  isPmSubtaskProcess,
  buildPmPortfolioFromRecords,
} = require('./pmPortfolio');

test('process id split: tasks vs sub-tasks', () => {
  assert.equal(isPmTaskProcess('Project_Sub_Task_A01'), true);
  assert.equal(isPmSubtaskProcess('Project_Sub_Task_A01'), false);
  assert.equal(isPmSubtaskProcess('Sub_Task_Process_A00'), true);
  assert.equal(isPmTaskProcess('Sub_Task_Process_A00'), false);
  assert.equal(isPmTaskProcess('Live_IT_Service_Request_A00'), false);
});

test('projectKeyFromRaw matches email KPI helper fields', () => {
  assert.equal(projectKeyFromRaw({ Project_ID_Hidden: 'P-9' }), 'P-9');
  assert.equal(projectKeyFromRaw({ Project_ID: { _id: 'abc', Project_Name: 'N' } }), 'abc');
  assert.equal(projectKeyFromRaw({ Project_Name: 'Solo' }), 'Solo');
  assert.equal(projectKeyFromRaw({ Project_ID: '{"_id":"obj"}' }), 'obj');
  assert.equal(projectKeyFromRaw({}), '');
});

test('portfolio counts projects / tasks / individual / sub-tasks', () => {
  const p = buildPmPortfolioFromRecords([
    { process_id: 'Project_Sub_Task_A01', project_id: 'P1', status: 'open' },
    { process_id: 'Project_Sub_Task_A01', project_id: 'P1', status: 'closed' },
    { process_id: 'Project_Sub_Task_A01', project_id: 'P2', status: 'closed' },
    { process_id: 'Project_Sub_Task_A01', status: 'open' },
    { process_id: 'Sub_Task_Process_A00', status: 'closed' },
    { process_id: 'Live_IT_Service_Request_A00', status: 'open' },
  ]);
  assert.equal(p.tasks_total, 4);
  assert.equal(p.tasks_open, 2);
  assert.equal(p.tasks_closed, 2);
  assert.equal(p.linked_tasks, 3);
  assert.equal(p.individual_total, 1);
  assert.equal(p.individual_open, 1);
  assert.equal(p.projects_total, 2);
  assert.equal(p.projects_open, 1);
  assert.equal(p.projects_closed, 1);
  assert.equal(p.subtasks_total, 1);
  assert.equal(p.subtasks_closed, 1);
});
