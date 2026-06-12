import { useEffect, useState } from 'react';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import { getSortedScheduleBlocks, isBlockPast, type ScheduleBlock } from '../store/selectors';
import {
  toggleBlockCompleted,
  toggleSubtaskCompleted,
  deleteBlock,
  moveBlock,
  addSubtask,
  deleteSubtask,
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
  useMinuteTick();
  const appearance = window.calderaAppearance;
  const blocks = getSortedScheduleBlocks(calData, date);
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [subtaskDraft, setSubtaskDraft] = useState('');

  useEffect(() => {
    setSubtaskDraft('');
  }, [selectedBlockId]);

  if (!blocks.length) {
    return (
      <div className="task-list">
        <div className="task-empty">No blocks scheduled for this day.{'\n'}Use Daily mode or drag on the Timeline to add one.</div>
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
              <div className="task-color-swatch" style={{ background: appearance?.gradientCss(block) ?? block.color }} />
              <div className="task-body">
                <div className="task-label">
                  {block.label}
                  {block.recurring && <span className="task-recur-badge">&#8635;</span>}
                </div>
                <div className="task-time">{formatBlockTimeRange(block)}</div>
              </div>

              <div className="task-actions" onClick={(event) => event.stopPropagation()}>
                {confirmingRecurringDelete ? (
                  <>
                    <button
                      className="task-btn"
                      title="Remove just from this day"
                      onClick={() => { void deleteBlock(date, block.id, 'today'); setDeletingRecurringId(null); }}
                    >
                      Today
                    </button>
                    <button
                      className="task-btn task-btn-del"
                      title="Remove from all days"
                      onClick={() => { void deleteBlock(date, block.id, 'all'); setDeletingRecurringId(null); }}
                    >
                      All
                    </button>
                    <button className="task-btn" title="Cancel" onClick={() => setDeletingRecurringId(null)}>&#8617;</button>
                  </>
                ) : (
                  <>
                    <button
                      className="task-btn"
                      title={block.completed ? 'Mark incomplete' : 'Mark complete'}
                      onClick={() => void toggleBlockCompleted(calData, date, block.id)}
                    >
                      {block.completed ? <>&#8634;</> : <>&#10003;</>}
                    </button>
                    <button className="task-btn" title="Edit block" onClick={() => onEdit(block)}>&#9998;</button>
                    {!block.recurring && (
                      <button
                        className="task-btn"
                        title="Move to another day"
                        onClick={() => { setReschedulingId(block.id); setRescheduleDate(stepDateKey(date, 1)); }}
                      >
                        &#8640;
                      </button>
                    )}
                    <button
                      className="task-btn task-btn-del"
                      title="Delete block"
                      onClick={() => { if (block.recurring) setDeletingRecurringId(block.id); else void deleteBlock(date, block.id); }}
                    >
                      &#10005;
                    </button>
                  </>
                )}
              </div>
            </div>

            {rescheduling && (
              <div className="task-reschedule" onClick={(event) => event.stopPropagation()}>
                <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
                <button
                  className="task-btn"
                  title="Move"
                  onClick={() => { void moveBlock(date, block.id, rescheduleDate); setReschedulingId(null); }}
                >
                  &#10003;
                </button>
                <button className="task-btn" title="Cancel" onClick={() => setReschedulingId(null)}>&#10005;</button>
              </div>
            )}

            {(block.subtasks.length > 0 || selected) && (
              <div className="task-subtasks" onClick={(event) => event.stopPropagation()}>
                {block.subtasks.map((task) => (
                  <div key={task.id} className={'schedule-subtask-item' + (task.completed ? ' completed' : '')}>
                    <button
                      className="schedule-subtask-toggle"
                      title={task.completed ? 'Mark sub-task incomplete' : 'Mark sub-task complete'}
                      onClick={() => void toggleSubtaskCompleted(calData, date, block.id, task.id)}
                    >
                      {task.completed ? <>&#8634;</> : <>&#10003;</>}
                    </button>
                    <div className="schedule-subtask-label">{task.label}</div>
                    <button
                      className="schedule-subtask-delete"
                      title="Delete sub-task"
                      onClick={() => void deleteSubtask(date, block.id, task.id)}
                    >
                      &#10005;
                    </button>
                  </div>
                ))}
                {selected && (
                  <form
                    className="task-subtask-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = subtaskDraft.trim();
                      if (value) {
                        void addSubtask(date, block.id, value);
                        setSubtaskDraft('');
                      }
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
