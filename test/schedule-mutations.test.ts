import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addSubtaskToBlock,
  deleteSubtaskFromBlock,
  moveOneOffBlockToDate,
} from '../src/react/store/scheduleMutations';
import type { CalData, RecurringBlock, TimeBlock } from '../src/types';

function oneOff(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'b1', startMin: 60, endMin: 120, label: 'Block', color: '#fff',
    paletteSlot: 2, ampm: 'AM', completed: false, subtasks: [], ...over,
  };
}

function recurring(over: Partial<RecurringBlock> = {}): RecurringBlock {
  return {
    id: 'r1', startMin: 0, endMin: 60, label: 'Recur', color: '#000', paletteSlot: 1, ampm: 'AM',
    recurrence: 'daily', dayOfWeek: 0, dayOfMonth: 1, completedDates: [],
    excludedDates: [], subtasks: [], ...over,
  };
}

test('should add a trimmed sub-task to a recurring block', () => {
  const calData: CalData = { _recurring: [recurring()] };

  const changed = addSubtaskToBlock(calData, '2026-06-10', 'r1', '  Follow up  ');

  assert.equal(changed, true);
  assert.equal(calData._recurring[0].subtasks.length, 1);
  assert.equal(calData._recurring[0].subtasks[0]?.label, 'Follow up');
  assert.equal(calData._recurring[0].subtasks[0]?.completed, false);
});

test('should ignore blank sub-task labels without mutating the block', () => {
  const calData: CalData = {
    _recurring: [],
    '2026-06-10': { events: [], featuredId: null, timeBlocks: [oneOff()] },
  };

  const changed = addSubtaskToBlock(calData, '2026-06-10', 'b1', '   ');

  assert.equal(changed, false);
  assert.deepEqual((calData['2026-06-10'] as { timeBlocks: TimeBlock[] }).timeBlocks[0]?.subtasks, []);
});

test('should delete an existing sub-task from a one-off block', () => {
  const calData: CalData = {
    _recurring: [],
    '2026-06-10': {
      events: [],
      featuredId: null,
      timeBlocks: [oneOff({ subtasks: [{ id: 's1', label: 'Prep', completed: false }, { id: 's2', label: 'Ship', completed: true }] })],
    },
  };

  const changed = deleteSubtaskFromBlock(calData, '2026-06-10', 'b1', 's1');

  assert.equal(changed, true);
  assert.deepEqual((calData['2026-06-10'] as { timeBlocks: TimeBlock[] }).timeBlocks[0]?.subtasks, [
    { id: 's2', label: 'Ship', completed: true },
  ]);
});

test('should move a one-off block to another day and preserve its stored appearance', () => {
  const block = oneOff({ id: 'b2', color: '#4f6ef7', paletteSlot: 4 });
  const calData: CalData = {
    _recurring: [],
    '2026-06-10': { events: [], featuredId: null, timeBlocks: [block] },
  };

  const changed = moveOneOffBlockToDate(calData, '2026-06-10', 'b2', '2026-06-11');

  assert.equal(changed, true);
  assert.equal(calData['2026-06-10'], undefined);
  const moved = (calData['2026-06-11'] as { timeBlocks: TimeBlock[] }).timeBlocks[0];
  assert.equal(moved?.id, 'b2');
  assert.equal(moved?.color, '#4f6ef7');
  assert.equal(moved?.paletteSlot, 4);
});

test('should ignore same-day and missing-block move requests', () => {
  const original = oneOff({ id: 'b3' });
  const calData: CalData = {
    _recurring: [],
    '2026-06-10': { events: [{ id: 'e1', image: null, notes: '', time: '' }], featuredId: 'e1', timeBlocks: [original] },
  };

  const sameDayChanged = moveOneOffBlockToDate(calData, '2026-06-10', 'b3', '2026-06-10');
  const missingChanged = moveOneOffBlockToDate(calData, '2026-06-10', 'missing', '2026-06-11');

  assert.equal(sameDayChanged, false);
  assert.equal(missingChanged, false);
  assert.equal((calData['2026-06-10'] as { timeBlocks: TimeBlock[] }).timeBlocks[0]?.id, 'b3');
  assert.equal(calData['2026-06-11'], undefined);
});
