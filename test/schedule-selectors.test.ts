import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRecurringBlocksForDate,
  getScheduleBlocksForDate,
  getSortedScheduleBlocks,
  inferClockBlockAmpm,
  isBlockPast,
} from '../src/react/store/selectors';
import type { CalData, RecurringBlock, TimeBlock } from '../src/types';

function oneOff(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'b1', startMin: 60, endMin: 120, label: 'Block', color: '#fff',
    ampm: 'AM', completed: false, subtasks: [], ...over,
  };
}

function recurring(over: Partial<RecurringBlock> = {}): RecurringBlock {
  return {
    id: 'r1', startMin: 0, endMin: 60, label: 'Recur', color: '#000', ampm: 'AM',
    recurrence: 'daily', dayOfWeek: 0, dayOfMonth: 1, completedDates: [],
    excludedDates: [], subtasks: [], ...over,
  };
}

test('should include daily recurring blocks but exclude explicitly excluded dates', () => {
  const calData: CalData = { _recurring: [recurring({ recurrence: 'daily', excludedDates: ['2026-03-13'] })] };
  assert.equal(getRecurringBlocksForDate(calData, '2026-03-12').length, 1);
  assert.equal(getRecurringBlocksForDate(calData, '2026-03-13').length, 0);
});

test('should match weekly recurring blocks only on the configured weekday', () => {
  // 2026-03-12 is a Thursday (getDay() === 4).
  const calData: CalData = { _recurring: [recurring({ recurrence: 'weekly', dayOfWeek: 4 })] };
  assert.equal(getRecurringBlocksForDate(calData, '2026-03-12').length, 1);
  assert.equal(getRecurringBlocksForDate(calData, '2026-03-13').length, 0);
});

test('should match monthly recurring blocks only on the configured day of month', () => {
  const calData: CalData = { _recurring: [recurring({ recurrence: 'monthly', dayOfMonth: 12 })] };
  assert.equal(getRecurringBlocksForDate(calData, '2026-03-12').length, 1);
  assert.equal(getRecurringBlocksForDate(calData, '2026-04-13').length, 0);
});

test('should merge one-off and recurring blocks and derive recurring completion from completedDates', () => {
  const calData: CalData = {
    _recurring: [recurring({ id: 'r1', completedDates: ['2026-03-12'] })],
    '2026-03-12': { events: [], featuredId: null, timeBlocks: [oneOff({ id: 'b1' })] },
  };
  const blocks = getScheduleBlocksForDate(calData, '2026-03-12');
  assert.equal(blocks.length, 2);
  assert.equal(blocks.find((b) => b.id === 'b1')!.recurring, false);
  const recur = blocks.find((b) => b.id === 'r1')!;
  assert.equal(recur.recurring, true);
  assert.equal(recur.completed, true); // completedDates includes the date
});

test('should sort blocks by start time treating PM as twelve hours later', () => {
  const calData: CalData = {
    _recurring: [],
    '2026-03-12': {
      events: [], featuredId: null,
      timeBlocks: [
        oneOff({ id: 'pm', startMin: 60, ampm: 'PM' }),
        oneOff({ id: 'am', startMin: 300, ampm: 'AM' }),
      ],
    },
  };
  const order = getSortedScheduleBlocks(calData, '2026-03-12').map((b) => b.id);
  assert.deepEqual(order, ['am', 'pm']); // 5:00 AM before 1:00 PM
});

test('should treat past days as past and future days as not past regardless of clock', () => {
  const now = new Date(2026, 2, 12, 10, 0); // 10:00 on today
  const block = { startMin: 60, endMin: 120, ampm: 'AM' as const };
  assert.equal(isBlockPast(block, '2026-03-11', now, '2026-03-12'), true);
  assert.equal(isBlockPast(block, '2026-03-13', now, '2026-03-12'), false);
});

test('should mark a block past only once the current time is at or beyond its end', () => {
  const todayKey = '2026-03-12';
  const earlyBlock = { startMin: 0, endMin: 60, ampm: 'AM' as const };   // ends 1:00 AM
  const laterBlock = { startMin: 0, endMin: 60, ampm: 'PM' as const };   // ends 1:00 PM
  const now = new Date(2026, 2, 12, 9, 0); // 9:00 AM
  assert.equal(isBlockPast(earlyBlock, todayKey, now, todayKey), true);
  assert.equal(isBlockPast(laterBlock, todayKey, now, todayKey), false);
});

test('should infer AM for a dragged spot still ahead in the morning', () => {
  // 9:00 AM (540), drag the 11 o'clock spot (660): its AM time is still ahead → AM.
  assert.equal(inferClockBlockAmpm(660, 540), 'AM');
});

test('should infer PM for a morning-half spot that has already passed today', () => {
  // 9:00 AM (540), drag the 2 o'clock spot (120): 2 AM is past, so the next 2 o'clock is 2 PM.
  assert.equal(inferClockBlockAmpm(120, 540), 'PM');
});

test('should always infer PM once the current time is in the afternoon', () => {
  // 3:00 PM (900): every clock-face spot (0–719) is behind now, so the next one is PM.
  assert.equal(inferClockBlockAmpm(240, 900), 'PM'); // 4 o'clock → 4 PM
  assert.equal(inferClockBlockAmpm(600, 900), 'PM'); // 10 o'clock → 10 PM
});

test('should infer AM when a spot is reached exactly at the current minute', () => {
  // 4:00 AM (240) dragging the 4 o'clock spot (240): the AM occurrence is "now" → AM.
  assert.equal(inferClockBlockAmpm(240, 240), 'AM');
});
