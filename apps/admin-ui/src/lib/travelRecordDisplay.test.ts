import { describe, expect, it } from 'vitest';
import { hasVisibleMisTiles } from '@/components/feature/MisRecordExpandPanel';
import {
  TRAVEL_ADVANCE_COLUMNS,
  TRAVEL_DASH_COLUMNS,
  TRAVEL_EXPENSE_COLUMNS,
  TRAVEL_REQUEST_COLUMNS,
  isTravelCoreColumn,
  travelColumnsForPack,
  travelExpandTiles,
  travelPurposeText,
  travelRouteSummary,
} from './travelRecordDisplay';

describe('travel column packs', () => {
  it('keeps the top KPI table generic without request-only place columns', () => {
    expect(TRAVEL_DASH_COLUMNS.map((c) => c.id)).toEqual([
      'request_id',
      'requested_by',
      'assigned_to',
      'purpose',
      'company_name',
      'amount',
      'process_id',
      'current_step',
      'status',
      'created_at',
      'fare_route',
      'advance_days',
      'over_median_pct',
      'fare_check',
    ]);
    expect(isTravelCoreColumn('from_city')).toBe(false);
    expect(isTravelCoreColumn('trip_type')).toBe(false);
    expect(isTravelCoreColumn('travel_mode')).toBe(false);
    expect(travelColumnsForPack(null)).toEqual(TRAVEL_DASH_COLUMNS);
  });

  it('adds From / To / Trip type / Travel mode only on the travel request pack', () => {
    expect(travelColumnsForPack('booking')).toEqual(TRAVEL_REQUEST_COLUMNS);
    expect(TRAVEL_REQUEST_COLUMNS.map((c) => c.id)).toEqual([
      'request_id',
      'requested_by',
      'assigned_to',
      'purpose',
      'company_name',
      'trip_type',
      'from_city',
      'to_city',
      'travel_mode',
      'amount',
      'current_step',
      'status',
      'created_at',
      'fare_route',
      'advance_days',
      'over_median_pct',
      'fare_check',
    ]);
    expect(isTravelCoreColumn('from_city', 'booking')).toBe(true);
    expect(isTravelCoreColumn('trip_type', 'booking')).toBe(true);
    expect(isTravelCoreColumn('travel_mode', 'booking')).toBe(true);
    expect(isTravelCoreColumn('from_city', 'advance')).toBe(false);
    expect(travelColumnsForPack('advance')).toEqual(TRAVEL_ADVANCE_COLUMNS);
    expect(travelColumnsForPack('expense')).toEqual(TRAVEL_EXPENSE_COLUMNS);
    expect(TRAVEL_EXPENSE_COLUMNS.map((c) => c.id)).toContain('raised_amount');
    expect(TRAVEL_EXPENSE_COLUMNS.findIndex((c) => c.id === 'raised_amount'))
      .toBeLessThan(TRAVEL_EXPENSE_COLUMNS.findIndex((c) => c.id === 'amount'));
  });
});

describe('travelPurposeText', () => {
  it('prefers purpose then a real subject', () => {
    expect(travelPurposeText({ id: '1', purpose: 'Sales meet' })).toBe('Sales meet');
    expect(travelPurposeText({ id: '2', subject: 'Koppal site visit' })).toBe('Koppal site visit');
    expect(travelPurposeText({ id: '3', subject: 'Travel Request' })).toBe('');
    expect(travelPurposeText({ id: '4' })).toBe('');
  });
});

describe('travelRouteSummary', () => {
  it('builds a Chennai → Trichy banner with trip type', () => {
    expect(travelRouteSummary({
      id: '1',
      from_city: 'Chennai',
      to_city: 'Trichy',
      trip_type: 'oneWay',
    })).toEqual({
      from: 'Chennai',
      to: 'Trichy',
      tripType: 'One way',
      roundTrip: false,
    });
    expect(travelRouteSummary({
      id: '2',
      from_city: 'Chennai',
      to_city: 'Trichy',
      trip_type: 'Round_Trip',
    })?.roundTrip).toBe(true);
    expect(travelRouteSummary({ id: '3', purpose: 'Sales meet' })).toBeNull();
  });
});

describe('travelExpandTiles', () => {
  it('puts filled trip / place fields in expand and drops empty extras', () => {
    const tiles = travelExpandTiles({
      id: '1',
      purpose: 'Sales meet',
      travel_mode: 'Air',
      trip_type: 'One Way',
      from_city: 'Chennai',
      to_city: 'Coimbatore',
      departure_date: '2026-10-23T00:00:00.000Z',
      airline: 'IndiGo',
      flight_number: '479',
      linked_request_id: '',
      remarks: '—',
    });
    const filled = tiles.filter((t) => t.value);
    expect(filled.map((t) => t.label)).toEqual([
      'Trip type',
      'Departure date',
      'From place',
      'To place',
      'Travel mode',
      'Airline',
      'Flight number',
    ]);
    expect(filled.some((t) => t.label === 'Purpose')).toBe(false);
  });

  it('hides route tiles when the banner already shows the trip', () => {
    const tiles = travelExpandTiles({
      id: '1',
      trip_type: 'Round trip',
      from_city: 'Chennai',
      to_city: 'Trichy',
      travel_mode: 'Air',
      departure_date: '2026-10-23T00:00:00.000Z',
    }, { hideRouteFields: true, hideTravelMode: true });
    const filled = tiles.filter((t) => t.value);
    expect(filled.map((t) => t.label)).toEqual(['Departure date']);
  });

  it('hides expand when a row has no extra details', () => {
    expect(hasVisibleMisTiles(travelExpandTiles({ id: '1', purpose: 'Sales meet' }))).toBe(false);
    expect(hasVisibleMisTiles(travelExpandTiles({ id: '2', travel_mode: 'Air' }))).toBe(true);
    expect(hasVisibleMisTiles(travelExpandTiles({
      id: '3',
      trip_type: 'oneWay',
      from_city: 'Chennai',
      to_city: 'Coimbatore',
    }))).toBe(true);
  });

  it('does not surface blank trip / place tiles on advance or expense rows', () => {
    const tiles = travelExpandTiles({
      id: '4',
      process_id: 'Travel advance',
      trip_type: '—',
      from_city: '',
      to_city: '—',
      departure_date: null,
      linked_request_id: 'TRReq-1',
    });
    const filled = tiles.filter((t) => t.value);
    expect(filled.map((t) => t.label)).toEqual(['Linked travel request']);
  });

  it('adds fare-check tiles only after analysis is present', () => {
    const tiles = travelExpandTiles({
      id: '5',
      travel_mode: 'Air',
      fare_check: 'Flagged',
      advance_check: 'fail',
      cap_check: 'not evaluated',
      lowest_fare_check: 'not evaluated',
      cabin_check: 'not evaluated',
    });
    const fare = tiles.filter((t) => [
      'Advance purchase',
      'Fare cap',
      'Lowest logical fare',
      'Cabin class',
    ].includes(t.label));
    expect(fare.map((t) => t.value)).toEqual([
      'Fail',
      'Not evaluated',
      'Not evaluated',
      'Not evaluated',
    ]);
  });
});
