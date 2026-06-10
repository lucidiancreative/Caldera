// Write actions for the React Schedule view. They mutate the shared calData (the
// single source of truth owned by the vanilla renderer) and persist through the
// bridge, which normalizes, saves, and notifies every mirror — so a React edit
// repaints both React and the vanilla calendar. Snapshot first to keep undo/redo.
import type { CalData, RecurringBlock, TimeBlock } from '../../types';
import { saveCalData } from './calStore';
import { getDayData } from './selectors';

function findStoredBlock(calData: CalData, key: string, blockId: string): TimeBlock | RecurringBlock | null {
  const oneOff = getDayData(calData, key)?.timeBlocks?.find((block) => block.id === blockId);
  if (oneOff) return oneOff;
  return (calData._recurring || []).find((block) => block.id === blockId) || null;
}

export async function toggleBlockCompleted(calData: CalData, key: string, blockId: string): Promise<void> {
  window.calderaBridge?.pushSnapshot();
  const recurring = (calData._recurring || []).find((block) => block.id === blockId);
  if (recurring) {
    // Recurring completion is per-date, so it toggles membership in completedDates.
    if (!recurring.completedDates) recurring.completedDates = [];
    const index = recurring.completedDates.indexOf(key);
    if (index === -1) recurring.completedDates.push(key);
    else recurring.completedDates.splice(index, 1);
    await saveCalData();
    return;
  }
  const block = getDayData(calData, key)?.timeBlocks?.find((entry) => entry.id === blockId);
  if (!block) return;
  block.completed = !block.completed;
  await saveCalData();
}

export async function toggleSubtaskCompleted(
  calData: CalData,
  key: string,
  blockId: string,
  subtaskId: string,
): Promise<void> {
  const block = findStoredBlock(calData, key, blockId);
  const task = block?.subtasks?.find((entry) => entry.id === subtaskId);
  if (!block || !task) return;
  window.calderaBridge?.pushSnapshot();
  task.completed = !task.completed;
  await saveCalData();
}

// Thin wrappers over the schedule bridge, which runs the vanilla domain logic
// (palette slots, recurring conversion, scope handling) and persists + notifies.
const NOOP = Promise.resolve();

export const createBlock = (
  key: string,
  block: { startMin: number; endMin: number; label: string },
  recurrence: string,
  ampm: 'AM' | 'PM',
): Promise<void> => window.calderaSchedule?.createBlock(key, block, recurrence, ampm) ?? NOOP;

export const updateBlock = (
  key: string,
  id: string,
  label: string,
  recurrence: string,
  scope: string,
  ampm: 'AM' | 'PM',
): Promise<void> => window.calderaSchedule?.updateBlock(key, id, label, recurrence, scope, ampm) ?? NOOP;

export const deleteBlock = (key: string, id: string, scope?: string): Promise<void> =>
  window.calderaSchedule?.deleteBlock(key, id, scope) ?? NOOP;

export const moveBlock = (key: string, id: string, newKey: string): Promise<void> =>
  window.calderaSchedule?.moveBlock(key, id, newKey) ?? NOOP;

export const addSubtask = (key: string, id: string, label: string): Promise<void> =>
  window.calderaSchedule?.addSubtask(key, id, label) ?? NOOP;

export const deleteSubtask = (key: string, id: string, subtaskId: string): Promise<void> =>
  window.calderaSchedule?.deleteSubtask(key, id, subtaskId) ?? NOOP;
