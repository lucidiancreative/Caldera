// Pure timeline geometry + lane packing for the Schedule timeline. Kept free of
// DOM/React so it can be unit-tested. The lane packing is the key improvement over
// the vanilla single-lane timeline: overlapping blocks stack into separate lanes
// instead of colliding.
import type { ScheduleBlock } from '../store/selectors';

const DAY_MINUTES = 24 * 60;
const HALF_DAY_MINUTES = 12 * 60;
const MIN_BLOCK_MINUTES = 15;

export interface TimelineSegment {
  block: ScheduleBlock;
  start: number; // absolute minutes from midnight, clamped to the day
  end: number;
  lane: number;
}

export interface TimelineDaySegment extends TimelineSegment {
  date: string;
  occurrenceKey: string;
}

export interface TimelineResizePlan {
  blockId: string;
  linkedBlockId?: string;
  edge: 'start' | 'end';
  boundary: number;
  minBoundary: number;
  maxBoundary: number;
}

export function makeTimelineOccurrenceKey(date: string, blockId: string): string {
  return `${date}::${blockId}`;
}

type BlockTimes = Pick<ScheduleBlock, 'startMin' | 'endMin' | 'ampm'>;

function blockEndAmPm(block: BlockTimes): 'AM' | 'PM' {
  return block.endMin < block.startMin ? (block.ampm === 'AM' ? 'PM' : 'AM') : block.ampm;
}

/** Absolute minutes from midnight, unwrapping ends that cross into the next half/day. */
export function getAbsoluteMinutes(block: BlockTimes): { start: number; end: number } {
  const start = (block.ampm === 'PM' ? 720 : 0) + block.startMin;
  let end = (blockEndAmPm(block) === 'PM' ? 720 : 0) + block.endMin;
  if (end <= start) end += DAY_MINUTES;
  return { start, end };
}

/** Convert absolute day minutes back into the block storage shape used on disk. */
export function absoluteMinutesToBlockTimes(startAbs: number, endAbs: number): {
  ampm: 'AM' | 'PM';
  startMin: number;
  endMin: number;
} {
  let clampedStart = Math.max(0, Math.min(startAbs, DAY_MINUTES));
  let clampedEnd = Math.max(0, Math.min(endAbs, DAY_MINUTES));
  if (clampedEnd < clampedStart + MIN_BLOCK_MINUTES) {
    if (clampedStart + MIN_BLOCK_MINUTES <= DAY_MINUTES) {
      clampedEnd = clampedStart + MIN_BLOCK_MINUTES;
    } else {
      clampedStart = Math.max(0, DAY_MINUTES - MIN_BLOCK_MINUTES);
      clampedEnd = DAY_MINUTES;
    }
  }
  return {
    ampm: clampedStart >= HALF_DAY_MINUTES ? 'PM' : 'AM',
    startMin: clampedStart % HALF_DAY_MINUTES,
    endMin: clampedEnd % HALF_DAY_MINUTES,
  };
}

/** Parse a 24-hour `<input type="time">` value ("HH:MM") into minutes-since-midnight (0–1439). */
export function clockInputToAbsMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}

/** Format minutes-since-midnight back into the "HH:MM" value an `<input type="time">` expects. */
export function absMinutesToClockInput(abs: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(abs)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function snapTimelineMinutes(value: number): number {
  return Math.round(value / MIN_BLOCK_MINUTES) * MIN_BLOCK_MINUTES;
}

function clampTimelineMinutes(value: number): number {
  return Math.max(0, Math.min(DAY_MINUTES, snapTimelineMinutes(value)));
}

export function clientXToTimelineMinutes(clientX: number, trackLeft: number, hourWidth: number): number {
  const offsetX = clientX - trackLeft;
  return clampTimelineMinutes((offsetX / hourWidth) * 60);
}

export function getTimelineZoomScrollLeft(
  scrollLeft: number,
  viewportWidth: number,
  oldHourWidth: number,
  newHourWidth: number,
  frozenPaneWidth = 0,
): number {
  if (oldHourWidth <= 0 || newHourWidth <= 0) return Math.max(0, scrollLeft);
  const visibleTimelineWidth = Math.max(0, viewportWidth - frozenPaneWidth);
  const visibleCenterPx = Math.max(0, scrollLeft) + visibleTimelineWidth / 2;
  const nextCenterPx = visibleCenterPx * (newHourWidth / oldHourWidth);
  return Math.max(0, nextCenterPx - visibleTimelineWidth / 2);
}

export function getTimelineResizePlan(
  segments: TimelineSegment[],
  blockId: string,
  edge: 'start' | 'end',
): TimelineResizePlan | null {
  const target = segments.find((segment) => segment.block.id === blockId);
  if (!target) return null;

  const laneSegments = segments
    .filter((segment) => segment.lane === target.lane)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.block.label.localeCompare(b.block.label));
  const targetIndex = laneSegments.findIndex((segment) => segment.block.id === blockId);
  if (targetIndex === -1) return null;

  if (edge === 'start') {
    const previous = laneSegments[targetIndex - 1];
    const linked = previous && previous.end === target.start ? previous : null;
    return {
      blockId,
      ...(linked ? { linkedBlockId: linked.block.id } : {}),
      edge,
      boundary: target.start,
      minBoundary: linked ? linked.start + MIN_BLOCK_MINUTES : 0,
      maxBoundary: target.end - MIN_BLOCK_MINUTES,
    };
  }

  const next = laneSegments[targetIndex + 1];
  const linked = next && next.start === target.end ? next : null;
  return {
    blockId,
    ...(linked ? { linkedBlockId: linked.block.id } : {}),
    edge,
    boundary: target.end,
    minBoundary: target.start + MIN_BLOCK_MINUTES,
    maxBoundary: linked ? linked.end - MIN_BLOCK_MINUTES : DAY_MINUTES,
  };
}

/** Move a whole timeline segment while preserving its duration and staying within the day. */
export function moveTimelineRange(start: number, end: number, deltaMinutes: number): {
  start: number;
  end: number;
} {
  const duration = Math.max(MIN_BLOCK_MINUTES, end - start);
  const nextStart = Math.max(0, Math.min(start + deltaMinutes, Math.max(0, DAY_MINUTES - duration)));
  return {
    start: nextStart,
    end: nextStart + duration,
  };
}

function assignTimelineLanes<T extends TimelineSegment>(segments: T[]): { segments: T[]; laneCount: number } {
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

function toTimelineSegment<T extends { block: ScheduleBlock }>(entry: T): T & Pick<TimelineSegment, 'start' | 'end' | 'lane'> {
  const abs = getAbsoluteMinutes(entry.block);
  const start = Math.max(0, Math.min(abs.start, DAY_MINUTES));
  const end = Math.max(start + MIN_BLOCK_MINUTES, Math.min(abs.end, DAY_MINUTES));
  return { ...entry, start, end, lane: 0 };
}

/**
 * Greedy interval partitioning: blocks sorted by start time each take the lowest
 * lane whose previous block has already ended at/before this one starts. Overlapping
 * blocks therefore land in distinct lanes; sequential blocks reuse lane 0.
 */
export function packTimelineLanes(blocks: ScheduleBlock[]): { segments: TimelineSegment[]; laneCount: number } {
  const segments: TimelineSegment[] = blocks
    .map((block) => toTimelineSegment({ block }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.block.label.localeCompare(b.block.label));

  return assignTimelineLanes(segments);
}

export function packTimelineDay(date: string, blocks: ScheduleBlock[]): { segments: TimelineDaySegment[]; laneCount: number } {
  const segments: TimelineDaySegment[] = blocks
    .map((block) => toTimelineSegment({
      block,
      date,
      occurrenceKey: makeTimelineOccurrenceKey(date, block.id),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.block.label.localeCompare(b.block.label));

  return assignTimelineLanes(segments);
}
