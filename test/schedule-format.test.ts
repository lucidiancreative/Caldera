import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatWeekRange,
  getWeekDateKeys,
  getWeekStartKey,
} from '../src/react/util/format';

test('should anchor weekly schedule ranges to Sunday and include seven dates', () => {
  const weekDates = getWeekDateKeys('2026-06-11');

  assert.equal(getWeekStartKey('2026-06-11'), '2026-06-07');
  assert.deepEqual(weekDates, [
    '2026-06-07',
    '2026-06-08',
    '2026-06-09',
    '2026-06-10',
    '2026-06-11',
    '2026-06-12',
    '2026-06-13',
  ]);
});

test('should roll weekly schedule ranges cleanly across month and year boundaries', () => {
  assert.equal(getWeekStartKey('2026-01-01'), '2025-12-28');
  assert.deepEqual(getWeekDateKeys('2026-01-01'), [
    '2025-12-28',
    '2025-12-29',
    '2025-12-30',
    '2025-12-31',
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
  ]);
});

test('should format the visible week range for the schedule header', () => {
  assert.equal(formatWeekRange('2026-06-11'), 'Jun 7 - Jun 13, 2026');
  assert.equal(formatWeekRange('2026-01-01'), 'Dec 28 - Jan 3, 2026');
});
