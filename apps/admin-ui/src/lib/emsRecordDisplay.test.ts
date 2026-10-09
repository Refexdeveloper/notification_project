import { describe, expect, it } from 'vitest';
import { EMS_DASH_COLUMNS, emsExpandTiles, isEmsCoreColumn } from './emsRecordDisplay';

describe('EMS_DASH_COLUMNS', () => {
  it('matches HTML records plus Assigned to and Expense date', () => {
    expect(EMS_DASH_COLUMNS.map((c) => c.id)).toEqual([
      'request_id',
      'expense_type',
      'requested_by',
      'assigned_to',
      'amount',
      'current_step',
      'status',
      'entity',
      'company_name',
      'expense_date',
      'created_at',
    ]);
    expect(isEmsCoreColumn('assigned_to')).toBe(true);
    expect(isEmsCoreColumn('expense_date')).toBe(false);
    expect(isEmsCoreColumn('from_city')).toBe(false);
  });
});

describe('emsExpandTiles', () => {
  it('drops empty extras and does not repeat table columns', () => {
    const tiles = emsExpandTiles({
      id: '1',
      expense_type: 'Local Conveyance',
      assigned_to: 'Anil S Kulkarni',
      designation: 'Assistant Vice President',
      department: 'Operations',
      restaurant: '',
      from_city: 'Delhi Airport',
      remarks: '—',
    });
    const filled = tiles.filter((t) => t.value);
    expect(filled.map((t) => t.label)).toEqual([
      'Designation',
      'Department',
      'From place',
    ]);
    expect(filled.some((t) => t.label === 'Expense type')).toBe(false);
  });

  it('shows one tile per split, vehicle on conveyance, and pending step', () => {
    const tiles = emsExpandTiles({
      id: '2',
      expense_type: 'Food Claim, Local Conveyance',
      status: 'open',
      current_step: 'L1 Manager Approval',
      vehicle_type: 'Cab',
      expense_splits: [
        { type: 'Food Claim', amount: 8060 },
        { type: 'Local Conveyance', amount: 9000, vehicle: 'Cab' },
      ],
    });
    const filled = tiles.filter((t) => t.value);
    expect(filled).toEqual(expect.arrayContaining([
      { label: 'Food Claim', value: '₹8,060' },
      { label: 'Local Conveyance', value: '₹9,000 · Cab' },
      { label: 'Splits total', value: '₹17,060' },
      { label: 'Vehicle type', value: 'Cab' },
      { label: 'Pending at', value: 'L1 Manager Approval' },
    ]));
  });
});
