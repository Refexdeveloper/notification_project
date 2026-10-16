import { describe, expect, it } from 'vitest';
import {
  classifySolarCategory,
  classifySolarCategoryFromRow,
  solarPackCountsFromRecords,
  solarRowMatchesPack,
} from './solarCategory';

describe('classifySolarCategory', () => {
  it('treats Start through VP Approval as Operation', () => {
    expect(classifySolarCategory({}, 'Start')).toBe('Operation');
    expect(classifySolarCategory({}, 'HO Review')).toBe('Operation');
    expect(classifySolarCategory({}, 'VP Approval')).toBe('Operation');
    expect(classifySolarCategory({}, '')).toBe('Operation');
  });

  it('treats BU Approval onward as Finance', () => {
    expect(classifySolarCategory({}, 'BU Approval')).toBe('Finance');
    expect(classifySolarCategory({}, 'Finance Processing')).toBe('Finance');
    expect(classifySolarCategory({}, 'Finance Process')).toBe('Finance');
  });

  it('does not treat process status labels as Finance', () => {
    expect(classifySolarCategory({}, 'InProgress')).toBe('Operation');
    expect(classifySolarCategory({}, 'Rejected')).toBe('Operation');
  });

  it('treats process Completed as Finance (step after Finance Processing)', () => {
    expect(classifySolarCategory({ _status: 'Completed' }, '')).toBe('Finance');
    expect(classifySolarCategoryFromRow({ current_step: 'InProgress', status_raw: 'Completed', status: 'closed' })).toBe('Finance');
  });

  it('ignores finance-named departments while the step is still Operations', () => {
    const payload = {
      Department: 'Finance',
      Cost_Center: 'Accounts',
      Category: 'Invoice',
    };
    expect(classifySolarCategory(payload, 'HO Review')).toBe('Operation');
    expect(classifySolarCategory(payload, 'VP Approval')).toBe('Operation');
  });

  it('prefers Kissflow _current_step over poisoned InProgress current_step', () => {
    expect(classifySolarCategory({ _current_step: 'Finance Processing' }, 'InProgress')).toBe('Finance');
    expect(classifySolarCategory({ _current_step: 'BU Approval' }, 'InProgress')).toBe('Finance');
    expect(classifySolarCategory({ _current_step: 'HO Review' }, 'Site Expenses')).toBe('Operation');
  });

  it('classifies from row.current_step', () => {
    expect(classifySolarCategoryFromRow({ current_step: 'BU Approval' })).toBe('Finance');
    expect(classifySolarCategoryFromRow({ current_step: 'Finance Processing' })).toBe('Finance');
    expect(classifySolarCategoryFromRow({ current_step: 'VP Approval' })).toBe('Operation');
  });

  it('uses _current_context step when Kissflow has no _current_step (rejected)', () => {
    const payload = {
      _status: 'Rejected',
      _current_context: [{ _context_current_step: 'HO Review', _status: 'Rejected' }],
    };
    expect(classifySolarCategory(payload, 'Rejected')).toBe('Operation');
    expect(classifySolarCategory(payload, '')).toBe('Operation');
  });

  it('puts BU Approval rejection in Finance', () => {
    const payload = {
      _status: 'Rejected',
      _current_context: [{ _context_current_step: 'BU Approval', _status: 'Rejected' }],
    };
    expect(classifySolarCategory(payload, '')).toBe('Finance');
  });

  it('counts Operation Closed as moved-to-finance, Rejected by last real step', () => {
    const packs = solarPackCountsFromRecords([
      { current_step: 'Start', status: 'open' },
      { current_step: 'HO Review', status: 'open' },
      { current_step: 'VP Approval', status: 'open' },
      { current_step: 'HO Review', status: 'rejected', status_raw: 'Rejected' },
      { current_step: 'BU Approval', status: 'open' },
      { current_step: 'Finance Processing', status: 'open' },
      { current_step: 'Finance Processing', status: 'closed', status_raw: 'Completed' },
      { current_step: 'BU Approval', status: 'rejected', status_raw: 'Rejected' },
    ]);
    expect(packs.operation).toEqual({ open: 3, closed: 4, rejected: 1 });
    expect(packs.finance).toEqual({ open: 2, closed: 1, rejected: 1 });
    expect(solarRowMatchesPack({ current_step: 'BU Approval', status: 'open' }, 'operation', 'closed')).toBe(true);
    expect(solarRowMatchesPack({ current_step: 'HO Review', status: 'rejected' }, 'operation', 'rejected')).toBe(true);
    expect(solarRowMatchesPack({ current_step: 'BU Approval', status: 'rejected' }, 'finance', 'rejected')).toBe(true);
  });
});
