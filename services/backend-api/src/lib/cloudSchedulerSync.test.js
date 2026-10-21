'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  jobNameFor,
  knownCloudJobName,
  resolveLegacySchedulerId,
} = require('./cloudSchedulerSync');

test('known schedule UUIDs keep the live Cloud Scheduler job names', () => {
  assert.equal(jobNameFor('55555555-5555-4555-8555-555555555555'), 'sch-refex-itsm-daily');
  assert.equal(jobNameFor('99999999-9999-4999-8999-999999999999'), 'sch-refex-pm-daily');
  assert.equal(jobNameFor('d4cc8f6d-c3da-4bc2-9f9b-ca0ae159fffe'), 'sch-refex-travel-daily');
  assert.equal(jobNameFor('c5c3cc0c-2702-4018-a9eb-10fea3bde379'), 'sch-refex-travel-daily-refex');
  assert.equal(jobNameFor('f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4'), 'sch-rmc-lead-daily');
  assert.equal(jobNameFor('c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4'), 'sch-ril-rmc-expense-daily');
  assert.equal(knownCloudJobName('e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4'), 'sch-ril-rmc-travel-daily');
});

test('unknown schedule UUIDs still use ne-schedule-<id>', () => {
  assert.equal(
    jobNameFor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'ne-schedule-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
});

test('legacy id is used only when the schedule UUID is not in the live map', () => {
  assert.equal(
    jobNameFor('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'sch-custom-job'),
    'sch-custom-job',
  );
  assert.equal(
    jobNameFor('55555555-5555-4555-8555-555555555555', 'ne-schedule-55555555-5555-4555-8555-555555555555'),
    'sch-refex-itsm-daily',
  );
});

test('resolveLegacySchedulerId maps app + entity to the live job', () => {
  assert.equal(
    resolveLegacySchedulerId('Expense_and_Travel_Management_A00', 'Refex'),
    'sch-refex-travel-daily-refex',
  );
  assert.equal(
    resolveLegacySchedulerId('Expense_and_Travel_Management_A00', 'RIL_RMC'),
    'sch-ril-rmc-travel-daily',
  );
  assert.equal(resolveLegacySchedulerId('IT_Service_Management_A00', ''), 'sch-refex-itsm-daily');
  assert.equal(resolveLegacySchedulerId('IT_Service_Management_A00', 'all'), null);
  assert.equal(
    resolveLegacySchedulerId('IT_Service_Management_A00', 'Extrovis'),
    'ne-schedule-18e6c3a0-df09-473e-9c52-8993b7b1ea9b',
  );
  assert.equal(resolveLegacySchedulerId('Lead_Trcaker_A00', 'Adonis'), 'sch-refex-lead-prod-adonis');
});
