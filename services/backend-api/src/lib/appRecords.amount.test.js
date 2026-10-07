'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickAmountFromRaw } = require('./appRecords');

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
