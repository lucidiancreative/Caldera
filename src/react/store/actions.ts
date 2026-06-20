// Write actions for the React Schedule view. They mutate the shared calData (the
// single source of truth owned by the vanilla renderer) and persist through the
// bridge, which normalizes, saves, and notifies every mirror — so a React edit
// repaints both React and the vanilla calendar. Snapshot first to keep undo/redo.
import type { CalData } from '../../types';
import { saveCalData } from './calStore';
import { getDayData } from './selectors';
import {
  addSubtaskToBlock,
  deleteSubtaskFromBlock,
  findStoredBlock,
  moveOneOffBlockToDate,
  updateSubtaskNotesInBlock,
} from './scheduleMutations';

type RendererWindow = typeof globalThis & {
  calderaBridge?: {
    getData(): CalData;
    notify?(): void;
    pushSnapshot(): void;
  };
  calderaSchedule?: {
    createBlock(
      key: string,
      block: { startMin: number; endMin: number; label: string },
      recurrence: string,
      ampm: 'AM' | 'PM',
    ): Promise<void>;
    updateBlock(
      key: string,
      id: string,
      label: string,
      recurrence: string,
      scope: string,
      ampm: 'AM' | 'PM',
    ): Promise<void>;
    deleteBlock(key: string, id: string, scope?: string): Promise<void>;
  };
};

declare const window: RendererWindow;

const pendingCreateBlocks = new Map<string, Promise<void>>();

function snapshotCalendarData(): string | null {
  const data = window.calderaBridge?.getData();
  return data ? JSON.stringify(data) : null;
}

function restoreCalendarData(snapshot: string | null): void {
  if (!snapshot) return;
  const current = window.calderaBridge?.getData();
  if (!current) return;
  const restored = JSON.parse(snapshot) as CalData;
  for (const key of Object.keys(current)) {
    delete (current as Record<string, unknown>)[key];
  }
  Object.assign(current, restored);
  window.calderaBridge?.notify?.();
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

export async function updateBlockTimes(
  calData: CalData,
  key: string,
  blockId: string,
  startMin: number,
  endMin: number,
  ampm: 'AM' | 'PM',
): Promise<void> {
  const block = findStoredBlock(calData, key, blockId);
  if (!block) return;
  window.calderaBridge?.pushSnapshot();
  block.startMin = startMin;
  block.endMin = endMin;
  block.ampm = ampm;
  await saveCalData();
}

export async function updateBlockTimesBatch(
  calData: CalData,
  key: string,
  updates: Array<{
    blockId: string;
    startMin: number;
    endMin: number;
    ampm: 'AM' | 'PM';
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  window.calderaBridge?.pushSnapshot();
  let changed = false;
  for (const update of updates) {
    const block = findStoredBlock(calData, key, update.blockId);
    if (!block) continue;
    block.startMin = update.startMin;
    block.endMin = update.endMin;
    block.ampm = update.ampm;
    changed = true;
  }
  if (!changed) return;
  await saveCalData();
}

// Thin wrappers over the schedule bridge, which runs the vanilla domain logic
// (palette slots, recurring conversion, scope handling) and persists + notifies.
const NOOP = Promise.resolve();

function getCreateBlockRequestKey(
  key: string,
  block: { startMin: number; endMin: number; label: string },
  recurrence: string,
  ampm: 'AM' | 'PM',
): string {
  return JSON.stringify([key, block.startMin, block.endMin, block.label.trim(), recurrence, ampm]);
}

export function createBlock(
  key: string,
  block: { startMin: number; endMin: number; label: string },
  recurrence: string,
  ampm: 'AM' | 'PM',
): Promise<void> {
  const requestKey = getCreateBlockRequestKey(key, block, recurrence, ampm);
  const existing = pendingCreateBlocks.get(requestKey);
  if (existing) return existing;
  const snapshot = snapshotCalendarData();

  const request = (window.calderaSchedule?.createBlock(key, block, recurrence, ampm) ?? NOOP)
    .catch((error) => {
      restoreCalendarData(snapshot);
      throw error;
    })
    .finally(() => {
      if (pendingCreateBlocks.get(requestKey) === request) {
        pendingCreateBlocks.delete(requestKey);
      }
    });

  pendingCreateBlocks.set(requestKey, request);
  return request;
}

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

export async function moveBlock(key: string, id: string, newKey: string): Promise<void> {
  if (!newKey || newKey === key) return;
  const calData = window.calderaBridge?.getData();
  if (!calData || !getDayData(calData, key)?.timeBlocks?.some((block) => block.id === id)) return;
  window.calderaBridge?.pushSnapshot();
  if (!moveOneOffBlockToDate(calData, key, id, newKey)) return;
  await saveCalData();
}

// Move a one-off block to another day AND reposition it there in a single snapshot/save
// — the cross-day drag on the Week timeline. Recurring blocks never reach here (they have
// no stored date to move), so this only ever handles one-off blocks.
export async function moveBlockToDate(
  calData: CalData,
  key: string,
  blockId: string,
  newKey: string,
  times: { startMin: number; endMin: number; ampm: 'AM' | 'PM' },
): Promise<void> {
  if (!newKey || newKey === key) return;
  if (!getDayData(calData, key)?.timeBlocks?.some((block) => block.id === blockId)) return;
  window.calderaBridge?.pushSnapshot();
  if (!moveOneOffBlockToDate(calData, key, blockId, newKey)) return;
  const block = findStoredBlock(calData, newKey, blockId);
  if (block) {
    block.startMin = times.startMin;
    block.endMin = times.endMin;
    block.ampm = times.ampm;
  }
  await saveCalData();
}

export async function addSubtask(key: string, id: string, label: string): Promise<void> {
  if (!label.trim()) return;
  const calData = window.calderaBridge?.getData();
  if (!calData || !findStoredBlock(calData, key, id)) return;
  window.calderaBridge?.pushSnapshot();
  if (!addSubtaskToBlock(calData, key, id, label)) return;
  await saveCalData();
}

export async function deleteSubtask(key: string, id: string, subtaskId: string): Promise<void> {
  const calData = window.calderaBridge?.getData();
  const block = calData ? findStoredBlock(calData, key, id) : null;
  if (!calData || !block?.subtasks?.some((entry) => entry.id === subtaskId)) return;
  window.calderaBridge?.pushSnapshot();
  if (!deleteSubtaskFromBlock(calData, key, id, subtaskId)) return;
  await saveCalData();
}

export async function updateSubtaskNotes(key: string, id: string, subtaskId: string, notes: string): Promise<void> {
  const calData = window.calderaBridge?.getData();
  const block = calData ? findStoredBlock(calData, key, id) : null;
  if (!calData || !block?.subtasks?.some((entry) => entry.id === subtaskId)) return;
  if ((block.subtasks.find((entry) => entry.id === subtaskId)?.notes || '') === notes.trim()) return;
  window.calderaBridge?.pushSnapshot();
  if (!updateSubtaskNotesInBlock(calData, key, id, subtaskId, notes)) return;
  await saveCalData();
}
