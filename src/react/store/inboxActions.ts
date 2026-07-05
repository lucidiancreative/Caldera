// Write actions for the per-calendar task inbox. Inbox tasks carry no scheduling
// domain logic (no palette slot, colour, or recurrence), so — like the subtask and
// move actions — they mutate the shared calData directly and persist through the
// bridge. Snapshot first so undo/redo covers them (pushSnapshot stringifies calData,
// which now includes _tasks).
import type { CalData } from '../../types';
import { saveCalData } from './calStore';
import { createBlock } from './actions';
import { getDayData } from './selectors';

type BridgeWindow = typeof globalThis & {
  calderaBridge?: { getData(): CalData; pushSnapshot(): void };
};

declare const window: BridgeWindow;

function generateInboxTaskId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function addInboxTask(calData: CalData, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  window.calderaBridge?.pushSnapshot();
  if (!Array.isArray(calData._tasks)) calData._tasks = [];
  calData._tasks.push({ id: generateInboxTaskId(), label: trimmed, completed: false });
  await saveCalData();
}

export async function toggleInboxTask(calData: CalData, taskId: string): Promise<void> {
  const task = (calData._tasks ?? []).find((entry) => entry.id === taskId);
  if (!task) return;
  window.calderaBridge?.pushSnapshot();
  task.completed = !task.completed;
  await saveCalData();
}

// Flag/unflag an inbox task as a deadline. The flag rides along to the block the task
// schedules into (see scheduleInboxTask / createBlockFromTask), which draws a red outline.
export async function toggleInboxTaskDeadline(calData: CalData, taskId: string): Promise<void> {
  const task = (calData._tasks ?? []).find((entry) => entry.id === taskId);
  if (!task) return;
  window.calderaBridge?.pushSnapshot();
  task.deadline = !task.deadline;
  await saveCalData();
}

export async function deleteInboxTask(calData: CalData, taskId: string): Promise<void> {
  if (!(calData._tasks ?? []).some((entry) => entry.id === taskId)) return;
  window.calderaBridge?.pushSnapshot();
  calData._tasks = (calData._tasks ?? []).filter((entry) => entry.id !== taskId);
  await saveCalData();
}

// Turn an inbox task into a scheduled one-off block (used by the drag-onto-timeline drop).
// createBlock runs the shared domain logic (palette slot + colour) and snapshots first —
// capturing "task present, no block" — so removing the task here WITHOUT a second snapshot
// means one undo reverts the whole drop. Returns the new block's id so the caller can select
// it for immediate adjustment.
export async function scheduleInboxTask(
  calData: CalData,
  taskId: string,
  date: string,
  startMin: number,
  endMin: number,
  ampm: 'AM' | 'PM',
): Promise<string | null> {
  const task = (calData._tasks ?? []).find((entry) => entry.id === taskId);
  if (!task) return null;
  const before = new Set((getDayData(calData, date)?.timeBlocks ?? []).map((block) => block.id));
  await createBlock(date, { startMin, endMin, label: task.label, ...(task.deadline ? { deadline: true } : {}) }, 'none', ampm);
  const created = (getDayData(calData, date)?.timeBlocks ?? []).find((block) => !before.has(block.id));
  calData._tasks = (calData._tasks ?? []).filter((entry) => entry.id !== taskId);
  await saveCalData();
  return created?.id ?? null;
}

// Turn an inbox task into a scheduled block using an explicit label/time/recurrence — the
// drop-onto-Month-cell path, where the block editor collects those details first. Same
// single-undo contract as scheduleInboxTask: createBlock snapshots the "task present, no
// block" state, so removing the task here without a second snapshot means one undo reverts
// the whole drop. calData is read from the bridge so the editor needn't hold a reference.
export async function createBlockFromTask(
  taskId: string,
  date: string,
  block: { startMin: number; endMin: number; label: string },
  recurrence: string,
  ampm: 'AM' | 'PM',
): Promise<void> {
  const calData = window.calderaBridge?.getData();
  if (!calData) return;
  const task = (calData._tasks ?? []).find((entry) => entry.id === taskId);
  await createBlock(date, { ...block, ...(task?.deadline ? { deadline: true } : {}) }, recurrence, ampm);
  if (task) {
    calData._tasks = (calData._tasks ?? []).filter((entry) => entry.id !== taskId);
  }
  await saveCalData();
}
