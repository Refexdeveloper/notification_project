'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickAmountFromRaw, buildLiveRecordRows, serializeRecordItem, overlayTravelPlacesFromItems, travelDetailFieldsFromRaw, emsDetailFieldsFromRaw, emsSplitsFromRaw } = require('./appRecords');

test('pickAmountFromRaw reads travel advance Final_amount', () => {
  assert.equal(pickAmountFromRaw({ Final_amount: 3000 }), 3000);
  assert.equal(pickAmountFromRaw({ advance_amount_in_number: '3000' }), 3000);
});

test('pickAmountFromRaw prefers a positive claim over a zero Total_Amount', () => {
  assert.equal(pickAmountFromRaw({
    Total_Claimable_Amount: 0,
    Total_Raised_Amount: 2105.78,
    Final_Bill_Amount: 125,
    Total_Amount: 0,
  }), 2105.78);
});

test('pickAmountFromRaw parses INR strings and nested v', () => {
  assert.equal(pickAmountFromRaw({ Ticker_Fare: '2000 INR' }), 2000);
  assert.equal(pickAmountFromRaw({ Amount: { v: 601 } }), 601);
  assert.equal(pickAmountFromRaw({ FS_Booking_Amount: 45312 }), 45312);
});

test('pickAmountFromRaw returns null when no amount field exists', () => {
  assert.equal(pickAmountFromRaw({ Title: 'Trip' }), null);
  assert.equal(pickAmountFromRaw(null), null);
});

test('travel records keep from/to/departure/trip on the API row', () => {
  const appId = 'Expense_and_Travel_Management_A00';
  const rows = buildLiveRecordRows([{
    _id: 'abc',
    _process_id: 'Travel_Management_A02',
    Request_ID: 'TRReq-1',
    Boarding_from: 'Chennai (MAA)',
    Destination_to_1: 'New Delhi (DEL)',
    Departure_Date: '2026-10-23',
    OnewayRound_tripNot_applicable: 'One Way',
    _status: 'InProgress',
    _created_at: '2026-10-01T10:00:00Z',
  }], appId);
  assert.equal(rows[0].from_city, 'Chennai (MAA)');
  assert.equal(rows[0].to_city, 'New Delhi (DEL)');
  assert.equal(rows[0].trip_type, 'One Way');
  assert.match(String(rows[0].departure_date), /^2026-10-23/);
  const api = serializeRecordItem(rows[0]);
  assert.equal(api.from_city, 'Chennai (MAA)');
  assert.equal(api.to_city, 'New Delhi (DEL)');
  assert.equal(api.trip_type, 'One Way');
  assert.match(String(api.departure_date), /^2026-10-23/);
});

test('travel details skip empty and Kissflow instance linked ids', () => {
  const booking = travelDetailFieldsFromRaw({
    Purpose_of_Travel: 'Sales meet',
    Travel_Mode: 'Air',
    Number_of_Travel_days: 3,
    Travel_Request_ID: 'TRReq-1',
    FS_Airline_Name: 'IndiGo',
    FS_Flight_Number: '479',
    Designation: 'Engineer',
  }, 'TRReq-1');
  assert.equal(booking.purpose, 'Sales meet');
  assert.equal(booking.travel_mode, 'Air');
  assert.equal(booking.travel_days, 3);
  assert.equal(booking.linked_request_id, undefined);
  assert.equal(booking.airline, 'IndiGo');

  const advance = travelDetailFieldsFromRaw({
    Travel_Request_ID: 'TRReq-Refex-FY26-019',
    Travel_Advance_Claim_Status: 'Not Deducted',
    Remarks: 'Koppal site visit',
  }, 'AD- 051');
  assert.equal(advance.linked_request_id, 'TRReq-Refex-FY26-019');
  assert.equal(advance.advance_claim_status, 'Not Deducted');
  assert.equal(advance.purpose, undefined);

  const expense = travelDetailFieldsFromRaw({
    Expense_Type_Concatenation: 'Travel Ticket,Local Conveyance,Food',
    Expense_Date: '2026-09-30',
    Total_Raised_Amount: 3911,
    Claimed_Amount: 2391,
  }, 'PkEKJ_HoBNIi');
  assert.equal(expense.expense_type, 'Travel Ticket,Local Conveyance,Food');
  assert.match(String(expense.expense_date), /^2026-09-30/);
  assert.equal(expense.raised_amount, 3911);
  assert.equal(expense.claimed_amount, 2391);
});

test('overlayTravelPlacesFromItems fills place fields from Kissflow items', () => {
  const appId = 'Expense_and_Travel_Management_A00';
  const out = overlayTravelPlacesFromItems(
    [{ id: 'abc', request_id: 'TRReq-1' }],
    [{
      _id: 'abc',
      FS_From_City: 'Chennai',
      FS_To_City: 'Coimbatore',
      FS_Departure_Date: '2026-10-23',
      FS_Trip_Type: 'oneWay',
    }],
    appId,
  );
  assert.equal(out[0].from_city, 'Chennai');
  assert.equal(out[0].to_city, 'Coimbatore');
  assert.equal(out[0].trip_type, 'oneWay');
  assert.match(String(out[0].departure_date), /^2026-10-23/);
});

test('ems details skip empty and concatenate expense types', () => {
  const details = emsDetailFieldsFromRaw({
    Expense_Date: '2026-10-05',
    Designation: 'Assistant Vice President',
    Department: 'Operations',
    Expense_By: 'Employee',
    Restaurant_Name: "McDonald's",
    From_1: 'Delhi Airport',
    To_1: 'Hotel Udmaan',
    Have_Advance: false,
    L1_Manager_Status: 'Approved',
  });
  assert.equal(details.designation, 'Assistant Vice President');
  assert.equal(details.from_city, 'Delhi Airport');
  assert.equal(details.have_advance, 'No');
  assert.match(String(details.expense_date), /^2026-10-05/);

  const rows = buildLiveRecordRows([{
    _id: 'ems1',
    _process_id: 'Travel_Expense_A00',
    Expense_ID: 'Exp--FY26-006',
    Expense_Type: ['Food Claim', 'Local Conveyance'],
    Expense_Date: '2026-10-05',
    Designation: 'AVP',
    Total_Amount: 17060,
    _status: 'InProgress',
    _created_at: '2026-10-05T07:27:53Z',
  }], 'EMS_001_A00');
  assert.equal(rows[0].expense_type, 'Food Claim, Local Conveyance');
  assert.equal(rows[0].designation, 'AVP');
  const api = serializeRecordItem(rows[0]);
  assert.equal(api.expense_type, 'Food Claim, Local Conveyance');
  assert.equal(api.designation, 'AVP');
  assert.match(String(api.expense_date), /^2026-10-05/);
});

test('overlay fills EMS extras from Kissflow items', () => {
  const out = overlayTravelPlacesFromItems(
    [{ id: 'ems1', request_id: 'Exp--FY26-006', expense_type: '—' }],
    [{
      _id: 'ems1',
      Expense_Type_1: 'Local Conveyance',
      Expense_Date: '2026-10-05',
      Department: 'Operations',
    }],
    'EMS_001_A00',
  );
  assert.equal(out[0].expense_type, 'Local Conveyance');
  assert.equal(out[0].department, 'Operations');
  assert.match(String(out[0].expense_date), /^2026-10-05/);
});
