// Pure timeline geometry + lane packing for the Schedule timeline. Kept free of
// DOM/React so it can be unit-tested. The lane packing is the key improvement over
// the vanilla single-lane timeline: overlapping blocks stack into separate lanes
// instead of colliding.
import type { ScheduleBlock } from '../store/selectors';

const DAY_MINUTES = 24 * 60;

export interface TimelineSegment {
  block: ScheduleBlock;
  start: number; // absolute minutes from midnight, clamped to the day
  end: number;
  lane: number;
}

function blockEndAmPm(block: ScheduleBlock): 'AM' | 'PM' {
  return block.endMin < block.startMin ? (block.ampm === 'AM' ? 'PM' : 'AM') : block.ampm;
}

/** Absolute minutes from midnight, unwrapping ends that cross into the next half/day. */
export function getAbsoluteMinutes(block: ScheduleBlock): { start: number; end: number } {
  const start = (block.ampm === 'PM' ? 720 : 0) + block.startMin;
  let end = (blockEndAmPm(block) === 'PM' ? 720 : 0) + block.endMin;
  if (end <= start) end += DAY_MINUTES;
  return { start, end };
}

/**
 * Greedy interval partitioning: blocks sorted by start time each take the lowest
 * lane whose previous block has already ended at/before this one starts. Overlapping
 * blocks therefore land in distinct lanes; sequential blocks reuse lane 0.
 */
export function packTimelineLanes(blocks: ScheduleBlock[]): { segments: TimelineSegment[]; laneCount: number } {
  const segments: TimelineSegment[] = blocks
    .map((block) => {
      const abs = getAbsoluteMinutes(block);
      const start = Math.max(0, Math.min(abs.start, DAY_MINUTES));
      const end = Math.max(start + 15, Math.min(abs.end, DAY_MINUTES));
      return { block, start, end, lane: 0 };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.block.label.localeCompare(b.block.label));

  const laneEnds: number[] = []; // last occupied end-minute per lane
  for (const segment of segments) {
    let lane = laneEnds.findIndex((end) => end <= segment.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.end);
    } else {
      laneEnds[lane] = segment.end;
    }
    segment.lane = lane;
  }

  return { segments, laneCount: Math.max(1, laneEnds.length) };
}
