import { useState } from 'react';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import { getSortedScheduleBlocks, isBlockPast, type ScheduleBlock } from '../store/selectors';
import { toggleBlockCompleted, deleteBlock } from '../store/actions';
import { formatBlockTimeRange, getTodayKey } from '../util/format';

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
          </div>
        );
      })}
    </div>
  );
}
