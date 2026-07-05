import test from 'node:test';
import assert from 'node:assert/strict';

import {
  packTimelineLanes,
  packTimelineDay,
  getAbsoluteMinutes,
  absoluteMinutesToBlockTimes,
  absMinutesToClockInput,
  clockInputToAbsMinutes,
  clientXToTimelineMinutes,
  getTimelineZoomScrollLeft,
  getTimelineResizePlan,
  makeTimelineOccurrenceKey,
  moveTimelineRange,
} from '../src/react/schedule/timeline';
import type { ScheduleBlock } from '../src/react/store/selectors';

function block(over: Partial<ScheduleBlock>): ScheduleBlock {
  return {
    id: 'x', startMin: 0, endMin: 60, label: 'x', color: '#000',
    ampm: 'AM', completed: false, deadline: false, subtasks: [], recurring: false, ...over,
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

test('should convert absolute minutes back into block storage shape', () => {
  assert.deepEqual(absoluteMinutesToBlockTimes(90, 180), {
    ampm: 'AM',
    startMin: 90,
    endMin: 180,
  });
  assert.deepEqual(absoluteMinutesToBlockTimes(780, 855), {
    ampm: 'PM',
    startMin: 60,
    endMin: 135,
  });
});

test('should clamp absolute times to the day and enforce a 15-minute minimum', () => {
  assert.deepEqual(absoluteMinutesToBlockTimes(-20, 5), {
    ampm: 'AM',
    startMin: 0,
    endMin: 15,
  });
  assert.deepEqual(absoluteMinutesToBlockTimes(1435, 1500), {
    ampm: 'PM',
    startMin: 705,
    endMin: 0,
  });
});

test('should map a scrolled timeline cursor from the visible day track position', () => {
  const hourWidth = 96;
  const scrollLeft = 480;
  const trackLeft = 104 - scrollLeft;
  const clientX = trackLeft + (10 * hourWidth);

  assert.equal(clientXToTimelineMinutes(clientX, trackLeft, hourWidth), 600);
});

test('should preserve the visible timeline center when zooming', () => {
  const nextScrollLeft = getTimelineZoomScrollLeft(480, 704, 96, 144, 104);

  assert.equal(nextScrollLeft, 870);
});

test('should keep zoom scroll restoration within the timeline bounds', () => {
  assert.equal(getTimelineZoomScrollLeft(-20, 704, 96, 144, 104), 150);
  assert.equal(getTimelineZoomScrollLeft(480, 704, 0, 144, 104), 480);
});

test('should create a shared resize plan for touching blocks in the same lane', () => {
  const { segments } = packTimelineLanes([
    block({ id: 'a', ampm: 'AM', startMin: 540, endMin: 600 }),
    block({ id: 'b', ampm: 'AM', startMin: 600, endMin: 690 }),
  ]);

  assert.deepEqual(getTimelineResizePlan(segments, 'a', 'end'), {
    blockId: 'a',
    linkedBlockId: 'b',
    edge: 'end',
    boundary: 600,
    minBoundary: 555,
    maxBoundary: 675,
  });
});

test('should create a single-block resize plan when there is no touching neighbor', () => {
  const { segments } = packTimelineLanes([
    block({ id: 'solo', ampm: 'PM', startMin: 60, endMin: 120 }),
  ]);

  assert.deepEqual(getTimelineResizePlan(segments, 'solo', 'start'), {
    blockId: 'solo',
    edge: 'start',
    boundary: 780,
    minBoundary: 0,
    maxBoundary: 825,
  });
});

test('should move a block by the requested delta while preserving duration', () => {
  assert.deepEqual(moveTimelineRange(540, 630, 45), {
    start: 585,
    end: 675,
  });
});

test('should create unique occurrence keys for repeated recurring ids across different days', () => {
  assert.equal(makeTimelineOccurrenceKey('2026-06-07', 'recur-1'), '2026-06-07::recur-1');
  assert.notEqual(
    makeTimelineOccurrenceKey('2026-06-07', 'recur-1'),
    makeTimelineOccurrenceKey('2026-06-08', 'recur-1'),
  );
});

test('should stamp packed day segments with their source date and occurrence key', () => {
  const { segments, laneCount } = packTimelineDay('2026-06-11', [
    block({ id: 'standup', ampm: 'AM', startMin: 540, endMin: 600 }),
  ]);

  assert.equal(laneCount, 1);
  assert.deepEqual(segments.map((segment) => ({
    date: segment.date,
    occurrenceKey: segment.occurrenceKey,
    lane: segment.lane,
  })), [
    {
      date: '2026-06-11',
      occurrenceKey: '2026-06-11::standup',
      lane: 0,
    },
  ]);
});

test('should clamp moved blocks to the day bounds', () => {
  assert.deepEqual(moveTimelineRange(30, 120, -90), {
    start: 0,
    end: 90,
  });
  assert.deepEqual(moveTimelineRange(1320, 1410, 90), {
    start: 1350,
    end: 1440,
  });
});

test('should parse an HH:MM time input into minutes since midnight', () => {
  assert.equal(clockInputToAbsMinutes('09:00'), 540);
  assert.equal(clockInputToAbsMinutes('13:30'), 810);
  assert.equal(clockInputToAbsMinutes('00:00'), 0);
});

test('should clamp and default malformed time inputs', () => {
  assert.equal(clockInputToAbsMinutes(''), 0);
  assert.equal(clockInputToAbsMinutes('not-a-time'), 0);
  assert.equal(clockInputToAbsMinutes('25:99'), 23 * 60 + 59);
});

test('should format minutes since midnight back into a padded HH:MM value', () => {
  assert.equal(absMinutesToClockInput(540), '09:00');
  assert.equal(absMinutesToClockInput(810), '13:30');
  assert.equal(absMinutesToClockInput(5), '00:05');
});

test('should clamp out-of-range minutes when formatting a time input', () => {
  assert.equal(absMinutesToClockInput(-30), '00:00');
  assert.equal(absMinutesToClockInput(2000), '23:59');
});
