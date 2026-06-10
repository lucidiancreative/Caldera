// Shared Schedule task list. Renders blocks from the pure selectors, emitting the
// same .task-item / .schedule-subtask classes as the vanilla list so it inherits all
// styling and skins. Per the chosen task model, sub-tasks render inline under each
// block; the selected block also gets an add-sub-task input. Full action parity:
// complete, edit, reschedule (one-off), and delete (with recurring today/all scope).
import { useState } from 'react';
import { useCalData } from '../store/calStore';
import { getSortedScheduleBlocks, isBlockPast, type ScheduleBlock } from '../store/selectors';
import {
  toggleBlockCompleted, toggleSubtaskCompleted,
  deleteBlock, moveBlock, addSubtask, deleteSubtask,
} from '../store/actions';
import { formatBlockTimeRange, getTodayKey, stepDateKey } from '../util/format';

interface TaskListProps {
  date: string;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onEdit: (block: ScheduleBlock) => void;
}

export function TaskList({ date, selectedBlockId, onSelect, onEdit }: TaskListProps) {
  const calData = useCalData();
  const blocks = getSortedScheduleBlocks(calData, date);
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [subtaskDraft, setSubtaskDraft] = useState('');

  if (!blocks.length) {
    return (
      <div className="task-list">
        <div className="task-empty">No blocks scheduled.{'\n'}Use Daily mode to add one.</div>
      </div>
    );
  }

  const now = new Date();
  const todayKey = getTodayKey();

  return (
    <div className="task-list">
      {blocks.map((block) => {
        const past = isBlockPast(block, date, now, todayKey) && !block.completed;
        const selected = block.id === selectedBlockId;
        const confirmingRecurringDelete = deletingRecurringId === block.id;
        const rescheduling = reschedulingId === block.id;

        return (
          <div key={block.id} className="task-entry">
            <div
              className={'task-item' + (selected ? ' selected' : '') + (block.completed ? ' completed' : '') + (past ? ' past' : '')}
              onClick={() => onSelect(block.id)}
            >
              <div className="task-color-swatch" style={{ background: block.color }} />
              <div className="task-body">
                <div className="task-label">
                  {block.label}
                  {block.recurring && <span className="task-recur-badge">↻</span>}
                </div>
                <div className="task-time">{formatBlockTimeRange(block)}</div>
              </div>

              <div className="task-actions" onClick={(event) => event.stopPropagation()}>
                {confirmingRecurringDelete ? (
                  <>
                    <button className="task-btn" title="Remove just from this day"
                      onClick={() => { void deleteBlock(date, block.id, 'today'); setDeletingRecurringId(null); }}>Today</button>
                    <button className="task-btn task-btn-del" title="Remove from all days"
                      onClick={() => { void deleteBlock(date, block.id, 'all'); setDeletingRecurringId(null); }}>All</button>
                    <button className="task-btn" title="Cancel" onClick={() => setDeletingRecurringId(null)}>↩</button>
                  </>
                ) : (
                  <>
                    <button className="task-btn" title={block.completed ? 'Mark incomplete' : 'Mark complete'}
                      onClick={() => void toggleBlockCompleted(calData, date, block.id)}>{block.completed ? '↺' : '✓'}</button>
                    <button className="task-btn" title="Edit block" onClick={() => onEdit(block)}>✎</button>
                    {!block.recurring && (
                      <button className="task-btn" title="Move to another day"
                        onClick={() => { setReschedulingId(block.id); setRescheduleDate(stepDateKey(date, 1)); }}>⧉</button>
                    )}
                    <button className="task-btn task-btn-del" title="Delete block"
                      onClick={() => { if (block.recurring) setDeletingRecurringId(block.id); else void deleteBlock(date, block.id); }}>×</button>
                  </>
                )}
              </div>
            </div>

            {rescheduling && (
              <div className="task-reschedule" onClick={(event) => event.stopPropagation()}>
                <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
                <button className="task-btn" title="Move"
                  onClick={() => { void moveBlock(date, block.id, rescheduleDate); setReschedulingId(null); }}>Move</button>
                <button className="task-btn" title="Cancel" onClick={() => setReschedulingId(null)}>✕</button>
              </div>
            )}

            {(block.subtasks.length > 0 || selected) && (
              <div className="task-subtasks" onClick={(event) => event.stopPropagation()}>
                {block.subtasks.map((task) => (
                  <div key={task.id} className={'schedule-subtask-item' + (task.completed ? ' completed' : '')}>
                    <button className="schedule-subtask-toggle" title={task.completed ? 'Mark sub-task incomplete' : 'Mark sub-task complete'}
                      onClick={() => void toggleSubtaskCompleted(calData, date, block.id, task.id)}>{task.completed ? '↺' : '✓'}</button>
                    <div className="schedule-subtask-label">{task.label}</div>
                    <button className="schedule-subtask-delete" title="Delete sub-task"
                      onClick={() => void deleteSubtask(date, block.id, task.id)}>×</button>
                  </div>
                ))}
                {selected && (
                  <form
                    className="task-subtask-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = subtaskDraft.trim();
                      if (value) { void addSubtask(date, block.id, value); setSubtaskDraft(''); }
                    }}
                  >
                    <input value={subtaskDraft} onChange={(event) => setSubtaskDraft(event.target.value)} placeholder="Add a sub-task" />
                    <button className="task-btn" type="submit" title="Add sub-task">+</button>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
