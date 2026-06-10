import test from 'node:test';
import assert from 'node:assert/strict';

import { packTimelineLanes, getAbsoluteMinutes } from '../src/react/schedule/timeline';
import type { ScheduleBlock } from '../src/react/store/selectors';

function block(over: Partial<ScheduleBlock>): ScheduleBlock {
  return {
    id: 'x', startMin: 0, endMin: 60, label: 'x', color: '#000',
    ampm: 'AM', completed: false, subtasks: [], recurring: false, ...over,
  };
}

test('should keep sequential non-overlapping blocks in a single lane', () => {
  const { laneCount, segments } = packTimelineLanes([
    block({ id: 'a', ampm: 'AM', startMin: 540, endMin: 660 }), // 9:00–11:00
    block({ id: 'b', ampm: 'AM', startMin: 660, endMin: 719 }), // 11:00–11:59
  ]);
  assert.equal(laneCount, 1);
  assert.ok(segments.every((s) => s.lane === 0));
});

test('should stack overlapping blocks into separate lanes', () => {
  const { laneCount } = packTimelineLanes([
    block({ id: 'a', ampm: 'AM', startMin: 540, endMin: 660 }), // 9:00–11:00
    block({ id: 'b', ampm: 'AM', startMin: 600, endMin: 700 }), // 10:00–11:40 (overlaps a)
  ]);
  assert.equal(laneCount, 2);
});

test('should use exactly two lanes for three blocks with at most two concurrent', () => {
  // Gym 6–8pm overlaps Stripe 6–7pm and Github 7–8pm, but Stripe and Github do not overlap.
  const { laneCount } = packTimelineLanes([
    block({ id: 'gym', ampm: 'PM', startMin: 360, endMin: 480 }),
    block({ id: 'stripe', ampm: 'PM', startMin: 360, endMin: 420 }),
    block({ id: 'github', ampm: 'PM', startMin: 420, endMin: 480 }),
  ]);
  assert.equal(laneCount, 2);
});

test('should unwrap a block whose end crosses midnight into absolute minutes', () => {
  const abs = getAbsoluteMinutes(block({ ampm: 'PM', startMin: 660, endMin: 60 })); // 11:00pm–1:00am
  assert.equal(abs.start, 1380);
  assert.equal(abs.end, 1500);
});
