import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatWeekRange,
  getWeekDateKeys,
  getWeekStartKey,
  stepMonthKey,
  withMonth,
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

test('should step Month-mode navigation by whole months keeping the day of month', () => {
  assert.equal(stepMonthKey('2026-06-18', 1), '2026-07-18');
  assert.equal(stepMonthKey('2026-06-18', -1), '2026-05-18');
});

test('should roll Month-mode steps across year boundaries', () => {
  assert.equal(stepMonthKey('2026-12-15', 1), '2027-01-15');
  assert.equal(stepMonthKey('2026-01-10', -1), '2025-12-10');
});

test('should clamp the day to the target month length when stepping months', () => {
  assert.equal(stepMonthKey('2026-01-31', 1), '2026-02-28'); // Feb 2026 has 28 days
  assert.equal(stepMonthKey('2024-01-31', 1), '2024-02-29'); // 2024 is a leap year
  assert.equal(stepMonthKey('2026-03-31', -1), '2026-02-28'); // Feb again, stepping back
});

test('should jump to a chosen month in the same year, clamping the day', () => {
  assert.equal(withMonth('2026-06-18', 0), '2026-01-18'); // → January, same year
  assert.equal(withMonth('2026-06-18', 11), '2026-12-18'); // → December
  assert.equal(withMonth('2026-01-31', 1), '2026-02-28'); // Jan 31 → Feb clamps to 28
});
