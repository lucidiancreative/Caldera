// Pure scheduling selectors over CalData — no DOM, no window, no React, so they
// can be unit-tested in isolation. These mirror the vanilla renderer's scheduling
// logic (getRecurringBlocksForDate / getScheduleBlocksForDate / task sort /
// isPastBlock) during the migration; the vanilla copies are removed once each view
// moves to React. Keep the two in lock-step until then.
import type { CalData, DayData, TimeBlock, RecurringBlock } from '../../types';

/** A one-off or recurring block flattened for a single day's schedule list. */
export interface ScheduleBlock {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
  color: string;
  paletteSlot?: number;
  ampm: 'AM' | 'PM';
  completed: boolean;
  subtasks: { id: string; label: string; completed: boolean }[];
  recurring: boolean;
  recurrence?: 'daily' | 'weekly' | 'monthly';
}

export function getDayData(calData: CalData, key: string): DayData | undefined {
  const value = calData[key];
  if (value && typeof value === 'object' && 'events' in value) return value as DayData;
  return undefined;
}

export function getRecurringBlocksForDate(calData: CalData, key: string): RecurringBlock[] {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return (calData._recurring || []).filter((block) => {
    if (block.excludedDates?.includes(key)) return false;
    if (block.recurrence === 'daily') return true;
    if (block.recurrence === 'weekly') return date.getDay() === block.dayOfWeek;
    if (block.recurrence === 'monthly') return day === block.dayOfMonth;
    return false;
  });
}

function fromOneOff(block: TimeBlock): ScheduleBlock {
  return {
    id: block.id,
    startMin: block.startMin,
    endMin: block.endMin,
    label: block.label,
    color: block.color,
    paletteSlot: block.paletteSlot,
    ampm: block.ampm,
    completed: block.completed,
    subtasks: block.subtasks || [],
    recurring: false,
  };
}

function fromRecurring(block: RecurringBlock, key: string): ScheduleBlock {
  return {
    id: block.id,
    startMin: block.startMin,
    endMin: block.endMin,
    label: block.label,
    color: block.color,
    paletteSlot: block.paletteSlot,
    ampm: block.ampm,
    completed: block.completedDates?.includes(key) || false,
    subtasks: block.subtasks || [],
    recurring: true,
    recurrence: block.recurrence,
  };
}

/** All blocks active on a date: the day's one-off blocks plus matching recurring blocks. */
export function getScheduleBlocksForDate(calData: CalData, key: string): ScheduleBlock[] {
  const oneOff = (getDayData(calData, key)?.timeBlocks || []).map(fromOneOff);
  const recurring = getRecurringBlocksForDate(calData, key).map((block) => fromRecurring(block, key));
  return [...oneOff, ...recurring];
}

/** Day order: earlier start first, treating PM as +12h, matching the vanilla task list. */
export function getSortedScheduleBlocks(calData: CalData, key: string): ScheduleBlock[] {
  return [...getScheduleBlocksForDate(calData, key)].sort((a, b) => {
    const aOrder = (a.ampm === 'PM' ? 720 : 0) + a.startMin;
    const bOrder = (b.ampm === 'PM' ? 720 : 0) + b.startMin;
    return aOrder - bOrder;
  });
}

/**
 * Whether a block's end time has already passed. `now` and `todayKey` are passed
 * in (not read from the clock) so the rule stays pure and testable. AM blocks whose
 * end wraps before their start are treated as crossing past noon.
 */
export function isBlockPast(
  block: Pick<ScheduleBlock, 'startMin' | 'endMin' | 'ampm'>,
  key: string,
  now: Date,
  todayKey: string,
): boolean {
  if (key < todayKey) return true;
  if (key > todayKey) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let endMin = block.ampm === 'PM' ? block.endMin + 720 : block.endMin;
  if (block.ampm === 'AM' && block.endMin < block.startMin) endMin = block.endMin + 720;
  return nowMin >= endMin;
}

/**
 * Pick the AM/PM half for a block dragged onto the 12-hour clock face now that there is
 * no toggle to choose it. `clockStartMin` is the wedge's start (0–719, measured from
 * 12 o'clock) and `nowMinuteOfDay` is the current minutes-since-midnight. Defaults to the
 * next occurrence of that spot: its AM time if still ahead today, otherwise the upcoming
 * PM time (so afternoons always land in PM). The editor can override before saving.
 */
export function inferClockBlockAmpm(clockStartMin: number, nowMinuteOfDay: number): 'AM' | 'PM' {
  return clockStartMin >= nowMinuteOfDay ? 'AM' : 'PM';
}
