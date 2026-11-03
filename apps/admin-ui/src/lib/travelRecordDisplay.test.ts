import { describe, expect, it } from 'vitest';
import { hasVisibleMisTiles } from '@/components/feature/MisRecordExpandPanel';
import {
  TRAVEL_ADVANCE_COLUMNS,
  TRAVEL_DASH_COLUMNS,
  TRAVEL_EXPENSE_COLUMNS,
  TRAVEL_REQUEST_COLUMNS,
  annotateTravelBookingFareRows,
  fareTrendFilterLabel,
  formatFareTrendPct,
  formatOverMedianPct,
  isTravelBookingRow,
  isTravelCoreColumn,
  travelSlaDisplay,
  travelColumnsForPack,
  travelExpandTiles,
  travelFareRoute,
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
      'status',
      'created_at',
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
      'policy_deviation_cost',
      'sla',
      'fare_trend',
      'status',
      'created_at',
    ]);
    expect(isTravelCoreColumn('reference_fare', 'booking')).toBe(false);
    expect(isTravelCoreColumn('deviation_pct', 'booking')).toBe(false);
    expect(isTravelCoreColumn('current_step', 'booking')).toBe(false);
    expect(isTravelCoreColumn('current_step', 'advance')).toBe(false);
    expect(isTravelCoreColumn('current_step', 'expense')).toBe(false);
    expect(isTravelCoreColumn('policy_deviation_cost', 'booking')).toBe(true);
    expect(isTravelCoreColumn('policy_deviation_cost', 'advance')).toBe(false);
    expect(travelColumnsForPack(null).map((c) => c.id)).not.toContain('reference_fare');
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

  it('adds fare tiles on Total bookings expand only', () => {
    const tiles = travelExpandTiles({
      id: '1',
      process_id: 'Travel_Management_A02',
      travel_mode: 'Air',
      reference_fare: 5822,
      policy_deviation_cost: 2644,
      deviation_pct: 2644 / 5822,
      fare_trend: 'Up',
      created_at: '2026-03-01',
      departure_date: '2026-03-13',
    }, { includeFareDetails: true });
    const filled = tiles.filter((t) => t.value);
    expect(filled.map((t) => t.label)).toEqual(expect.arrayContaining([
      'Policy deviation cost',
      'SLA',
      'Fare trend',
    ]));
    expect(filled.some((t) => t.label === 'Reference fare' || t.label === 'Deviation %')).toBe(false);
    expect(filled.filter((t) => t.label === 'Fare trend')).toHaveLength(1);
    expect(filled.find((t) => t.label === 'Fare trend')?.value).toBe('▲45%');
    expect(travelExpandTiles({
      id: '1',
      process_id: 'Travel_Management_A02',
      fare_trend: 'Up',
      deviation_pct: 0.45,
    }).some((t) => t.label === 'Fare trend' && t.value)).toBe(false);
    expect(isTravelBookingRow({ id: '1', process_id: 'Travel_Management_A02' })).toBe(true);
    expect(isTravelBookingRow({ id: '2', process_id: 'Travel Advance' })).toBe(false);
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
});

describe('travel booking fare columns', () => {
  it('uses UPPER(from)-UPPER(to) and groups Chennai (MAA) with Chennai', () => {
    expect(travelFareRoute('Chennai', 'Pune')).toBe('CHENNAI-PUNE');
    expect(travelFareRoute('Chennai (MAA)', 'Pune')).toBe('CHENNAI-PUNE');
  });

  it('matches the sample reference fare, policy deviation, and percent', () => {
    const rows = annotateTravelBookingFareRows([
      { id: '1', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune', amount: 5605, created_at: '2026-01-01' },
      { id: '2', travel_mode: 'Flight', from_city: 'Chennai (MAA)', to_city: 'Pune', amount: 5822, created_at: '2026-02-01' },
      { id: '3', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune', amount: 8466, created_at: '2026-03-01', departure_date: '2026-03-13', status: 'closed' },
      { id: '4', travel_mode: 'Bus', from_city: 'Chennai', to_city: 'Pune', amount: 2000 },
    ]);
    expect(rows[2].reference_fare).toBe(5822);
    expect(rows[2].policy_deviation_cost).toBe(2644);
    expect(rows[2].deviation_pct).toBeCloseTo(2644 / 5822);
    expect(formatOverMedianPct(rows[2].deviation_pct)).toBe('+45.4%');
    expect(rows[2].sla).toBe('Not breached · 12d');
    expect(travelSlaDisplay(rows[2])).toEqual({
      primary: 'Not breached',
      sub: '12d',
      state: 'ok',
    });
    expect(travelSlaDisplay({
      id: 'late',
      created_at: '2026-03-20',
      departure_date: '2026-03-13',
    })).toEqual({
      primary: 'Breached',
      sub: '7d',
      state: 'breached',
    });
    expect(rows[2].fare_trend).toBe('Up');
    expect(fareTrendFilterLabel(rows[2].fare_trend, rows[2].deviation_pct)).toBe('▲45%');
    expect(formatFareTrendPct(rows[2].deviation_pct)).toBe('45%');
    expect(fareTrendFilterLabel('Down', -0.03)).toBe('▼3%');
    expect(fareTrendFilterLabel('Flat', 0)).toBe('■0%');
    expect(fareTrendFilterLabel('Up', 0.001)).toBe('■0%');
    expect(fareTrendFilterLabel('Down', -0.004)).toBe('■0%');
    expect(rows[3].reference_fare).toBeNull();
    expect(rows[3].policy_deviation_cost).toBeNull();
    expect(rows[3].deviation_pct).toBeNull();
    expect(rows[3].fare_trend).toBeNull();
    expect(rows[3].sla).toBeNull();
  });

  it('keeps fare columns blank for other travel modes and still shows SLA when dates exist', () => {
    const rows = annotateTravelBookingFareRows([
      {
        id: 'bus',
        travel_mode: 'Bus',
        from_city: 'Chennai',
        to_city: 'Pune',
        amount: 1800,
        created_at: '2026-03-01',
        departure_date: '2026-03-13',
      },
      {
        id: 'hotel',
        travel_mode: 'Hotel',
        amount: 4000,
        created_at: '2026-03-01',
        departure_date: '2026-03-02',
      },
      {
        id: 'cab',
        travel_mode: 'Cab',
        amount: 900,
      },
    ]);
    for (const row of rows) {
      expect(row.reference_fare).toBeNull();
      expect(row.policy_deviation_cost).toBeNull();
      expect(row.deviation_pct).toBeNull();
      expect(row.fare_trend).toBeNull();
    }
    expect(rows[0].sla).toBe('Not breached · 12d');
    expect(rows[1].sla).toBe('Not breached · 1d');
    expect(rows[2].sla).toBeNull();
    const tiles = travelExpandTiles(rows[1], { includeFareDetails: true });
    expect(tiles.some((tile) => tile.label === 'SLA' && tile.value === 'Not breached · 1d')).toBe(true);
    expect(tiles.some((tile) => (tile.label === 'Fare trend' || tile.label === 'Reference fare') && tile.value)).toBe(false);
  });

  it('does not let advance or expense rows change booking fare medians', () => {
    const rows = annotateTravelBookingFareRows([
      { id: '1', process_id: 'Travel_Management_A02', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune', amount: 5605, created_at: '2026-01-01' },
      { id: '2', process_id: 'Travel_Management_A02', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune', amount: 5822, created_at: '2026-02-01' },
      { id: '3', process_id: 'Travel_Management_A02', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune', amount: 8466, created_at: '2026-03-01' },
      { id: 'adv', process_id: 'Advance_Payment_Request_Process_A01', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune', amount: 100 },
    ]);
    expect(rows[2].reference_fare).toBe(5822);
    expect(rows[3].reference_fare).toBeUndefined();
    expect(rows[3].fare_trend).toBeUndefined();
  });

  it('shows policy deviation on a closed flight even when the route has only one booking', () => {
    const rows = annotateTravelBookingFareRows([
      { id: '1', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Mumbai', amount: 7891, status: 'closed', status_raw: 'Completed' },
      { id: '2', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Kolkata', amount: 8000, status: 'open' },
      { id: '3', travel_mode: 'Air', from_city: 'Chennai', to_city: 'Kolkata', amount: 9000, status: 'Completed' },
    ]);
    expect(rows[0].policy_deviation_cost).toBe(0);
    expect(rows[0].fare_trend).toBe('Flat');
    expect(rows[1].policy_deviation_cost).toBeNull();
    expect(rows[1].fare_trend).toBeNull();
    expect(rows[2].policy_deviation_cost).toBe(500);
    expect(rows[2].fare_trend).toBe('Up');
  });

  it('shows policy deviation cost and fare trend only when the booking is closed', () => {
    const base = { travel_mode: 'Air', from_city: 'Chennai', to_city: 'Pune' };
    const rows = annotateTravelBookingFareRows([
      { ...base, id: '1', amount: 5605, created_at: '2026-01-01', status: 'closed' },
      { ...base, id: '2', amount: 5822, created_at: '2026-02-01', status: 'Closed' },
      { ...base, id: '3', amount: 8466, created_at: '2026-03-01', status: 'open' },
      { ...base, id: '4', amount: 9000, created_at: '2026-03-02', status: 'rejected' },
      { ...base, id: '5', amount: 7000, created_at: '2026-03-03' },
    ]);
    expect(rows[1].policy_deviation_cost).not.toBeNull();
    expect(rows[1].fare_trend).toBe('Up');
    for (const row of rows.slice(2)) {
      expect(row.policy_deviation_cost).toBeNull();
      expect(row.fare_trend).toBeNull();
      expect(row.reference_fare).not.toBeNull();
    }
    const openTiles = travelExpandTiles(rows[2], { includeFareDetails: true });
    expect(openTiles.some((t) => (t.label === 'Policy deviation cost' || t.label === 'Fare trend') && t.value)).toBe(false);
  });
});
