'use strict';

/**
 * Unit checks for ITSM requester company extract (no network).
 * Run: node tests/itsm-company-lookup.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  extractItsmCompanyNameFromRaw,
  companyTextFromRaw,
  buildLiveRecordRows,
} = require(path.join(
  __dirname,
  '..',
  'services/backend-api/src/lib/appRecords.js',
));

const ITSM = 'IT_Service_Management_A00';
const LEAD = 'Lead_Trcaker_A00';

assert.strictEqual(
  extractItsmCompanyNameFromRaw({
    user_details_lookup: { Company_Name: 'Refex Green Energy Limited' },
  }),
  'Refex Green Energy Limited',
);

assert.strictEqual(
  extractItsmCompanyNameFromRaw({
    Column_bRn4sBWeeF: { REFEX_COMPANY_NAME_1: 'Venwind Refex Power Limited' },
  }),
  'Venwind Refex Power Limited',
);

assert.strictEqual(
  extractItsmCompanyNameFromRaw({
    user_details_lookup: [{ v: { Company_Name: '3i Medical Technologies Private Limited' } }],
  }),
  '3i Medical Technologies Private Limited',
);

assert.strictEqual(
  extractItsmCompanyNameFromRaw({ Entity: 'Refex', Company: 'Refex' }),
  '',
);

assert.strictEqual(
  companyTextFromRaw({ Entity: 'Refex' }, ITSM),
  'Refex Industries Limited',
);

assert.strictEqual(
  companyTextFromRaw({
    Entity: 'Refex',
    user_details_lookup: { Company_Name: 'Refex Green Energy Limited' },
  }, ITSM),
  'Refex Green Energy Limited',
);

assert.ok(
  companyTextFromRaw({ Entity: 'Refex', Company: 'Acme Lead Co' }, LEAD).includes('Acme')
    || companyTextFromRaw({ Entity: 'Refex', Company: 'Acme Lead Co' }, LEAD) === 'Acme Lead Co',
);

const rows = buildLiveRecordRows([
  {
    _id: 'a',
    _process_id: 'Service_Items_Refex_A00',
    _status: 'Open',
    Entity: 'Refex',
    user_details_lookup: { Company_Name: 'Refex Green Energy Limited' },
    _request_number: 'IT-1',
  },
  {
    _id: 'b',
    _process_id: 'Service_Items_Refex_A00',
    _status: 'Open',
    Entity: 'Refex',
    _request_number: 'IT-2',
  },
], ITSM);

assert.strictEqual(rows[0].company_name, 'Refex Green Energy Limited');
assert.strictEqual(rows[0].entity_key, 'refex');
assert.strictEqual(rows[1].company_name, 'Refex Industries Limited');
assert.notStrictEqual(rows[1].company_name, 'Refex');

const assignedBlank = buildLiveRecordRows([
  {
    _id: 'c',
    _process_id: 'Service_Items_Refex_A00',
    _status: 'Completed',
    Entity: 'Refex',
    _request_number: 'IT-3',
    Requester: { Name: 'Ada Lovelace' },
    Closed_By: { Name: 'Sakthivel' },
    Owner: { Name: 'Owner Person' },
    Assigned_To_User: { Name: 'Duplicate User' },
    Column_9uwhycudkA: { Name: 'Assigned To User Field' },
  },
], ITSM);
assert.strictEqual(assignedBlank[0].assigned_to, '—');
assert.notStrictEqual(assignedBlank[0].assigned_to, 'Ada Lovelace');
assert.notStrictEqual(assignedBlank[0].assigned_to, 'Sakthivel');
assert.notStrictEqual(assignedBlank[0].assigned_to, 'Owner Person');

const assignedWorkflow = buildLiveRecordRows([
  {
    _id: 'd',
    _process_id: 'Service_Items_Refex_A00',
    _status: 'Open',
    Entity: 'Refex',
    _request_number: 'IT-4',
    _current_assigned_to: { Name: 'Bhukkay Naik' },
    Requester: { Name: 'Ada Lovelace' },
    Closed_By: { Name: 'Sakthivel' },
  },
], ITSM);
assert.strictEqual(assignedWorkflow[0].assigned_to, 'Bhukkay Naik');

const assignedExtrovisCol = buildLiveRecordRows([
  {
    _id: 'e',
    _process_id: 'Live_IT_Service_Request_Extrovis_A00',
    _status: 'Open',
    Entity: 'Extrovis',
    _request_number: 'IT-5',
    Column_7Fn1867jLF: { Name: 'Upendra Kumar Boddu' },
    Requester: { Name: 'Someone Else' },
  },
], ITSM);
assert.strictEqual(assignedExtrovisCol[0].assigned_to, 'Upendra Kumar Boddu');

const assignedRole = buildLiveRecordRows([
  {
    _id: 'f',
    _process_id: 'Service_Items_Refex_A00',
    _status: 'Open',
    Entity: 'Refex',
    _request_number: 'IT-6',
    Column_Q7Ygw5jzjd: { Name: 'IT Manager Refex' },
  },
], ITSM);
assert.strictEqual(assignedRole[0].assigned_to, 'Sakthivel');

console.log('itsm-company-lookup.test.js: ok');
