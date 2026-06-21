import type { CalData, DayData, RecurringBlock, TimeBlock } from '../../types';
import { getDayData } from './selectors';

function generateCalendarEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getOrInitDayData(calData: CalData, key: string): DayData {
  if (!calData[key] || typeof calData[key] !== 'object' || !('events' in (calData[key] as object))) {
    calData[key] = { events: [], featuredId: null, timeBlocks: [] };
  }
  const day = calData[key] as DayData;
  if (!day.timeBlocks) day.timeBlocks = [];
  return day;
}

export function findStoredBlock(calData: CalData, key: string, blockId: string): TimeBlock | RecurringBlock | null {
  const oneOff = getDayData(calData, key)?.timeBlocks?.find((block) => block.id === blockId);
  if (oneOff) return oneOff;
  return (calData._recurring || []).find((block) => block.id === blockId) || null;
}

export function detachRecurringOccurrenceToOneOff(
  calData: CalData,
  sourceKey: string,
  blockId: string,
  targetKey: string,
  times: { startMin: number; endMin: number; ampm: 'AM' | 'PM' },
): TimeBlock | null {
  if (!sourceKey || !targetKey) return null;
  const recurring = (calData._recurring || []).find((block) => block.id === blockId);
  if (!recurring) return null;
  if (!Array.isArray(recurring.excludedDates)) recurring.excludedDates = [];
  if (recurring.excludedDates.includes(sourceKey)) return null;

  recurring.excludedDates.push(sourceKey);
  const completed = recurring.completedDates?.includes(sourceKey) || false;
  if (completed && Array.isArray(recurring.completedDates)) {
    recurring.completedDates = recurring.completedDates.filter((date) => date !== sourceKey);
  }

  const oneOff: TimeBlock = {
    id: generateCalendarEntryId(),
    startMin: times.startMin,
    endMin: times.endMin,
    label: recurring.label,
    color: recurring.color,
    ...(recurring.paletteSlot !== undefined ? { paletteSlot: recurring.paletteSlot } : {}),
    ampm: times.ampm,
    completed,
    subtasks: (recurring.subtasks || []).map((subtask) => ({ ...subtask })),
  };

  getOrInitDayData(calData, targetKey).timeBlocks.push(oneOff);
  return oneOff;
}

export function addSubtaskToBlock(calData: CalData, key: string, blockId: string, label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  const block = findStoredBlock(calData, key, blockId);
  if (!block) return false;
  if (!Array.isArray(block.subtasks)) block.subtasks = [];
  block.subtasks.push({
    id: generateCalendarEntryId(),
    label: trimmed,
    completed: false,
    notes: '',
  });
  return true;
}

export function updateSubtaskNotesInBlock(
  calData: CalData,
  key: string,
  blockId: string,
  subtaskId: string,
  notes: string,
): boolean {
  const block = findStoredBlock(calData, key, blockId);
  const task = block?.subtasks?.find((entry) => entry.id === subtaskId);
  if (!task) return false;
  const nextNotes = notes.trim();
  if ((task.notes || '') === nextNotes) return false;
  task.notes = nextNotes;
  return true;
}

export function deleteSubtaskFromBlock(calData: CalData, key: string, blockId: string, subtaskId: string): boolean {
  const block = findStoredBlock(calData, key, blockId);
  if (!block?.subtasks?.some((entry) => entry.id === subtaskId)) return false;
  block.subtasks = block.subtasks.filter((entry) => entry.id !== subtaskId);
  return true;
}

export function moveOneOffBlockToDate(calData: CalData, key: string, blockId: string, newKey: string): boolean {
  if (!newKey || newKey === key) return false;
  const oldDay = getDayData(calData, key);
  const block = oldDay?.timeBlocks?.find((entry) => entry.id === blockId);
  if (!oldDay || !block) return false;
  oldDay.timeBlocks = oldDay.timeBlocks.filter((entry) => entry.id !== blockId);
  if (!oldDay.timeBlocks.length && !oldDay.events.length) delete calData[key];
  getOrInitDayData(calData, newKey).timeBlocks.push(block);
  return true;
}
