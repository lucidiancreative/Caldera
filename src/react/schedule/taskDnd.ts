// The drag contract for moving an inbox task onto the timeline. Kept in one place so
// the source (TaskInbox) and the drop target (TimelineMode) agree on the MIME type.
// The task id is the drag payload; it's only readable on `drop`, but `dataTransfer.types`
// is readable on `dragover`, so isTaskDrag() can gate the hover/preview before the drop.
export const TASK_DND_MIME = 'application/x-caldera-task';

export function isTaskDrag(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types).includes(TASK_DND_MIME);
}
