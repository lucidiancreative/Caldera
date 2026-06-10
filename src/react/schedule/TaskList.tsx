// Shared Schedule task list, rendered from the pure selectors. Emits the same
// .task-item / .schedule-subtask classes as the vanilla list so it inherits all
// existing styling and skin theming. Per the chosen task model, each block's
// sub-tasks render inline beneath it instead of in a separate panel.
import { useCalData } from '../store/calStore';
import { getSortedScheduleBlocks, isBlockPast } from '../store/selectors';
import { toggleBlockCompleted, toggleSubtaskCompleted } from '../store/actions';
import { formatBlockTimeRange, getTodayKey } from '../util/format';

interface TaskListProps {
  date: string;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}

export function TaskList({ date, selectedBlockId, onSelect }: TaskListProps) {
  const calData = useCalData();
  const blocks = getSortedScheduleBlocks(calData, date);

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
        return (
          <div key={block.id} className="task-entry">
            <div
              className={
                'task-item' +
                (selected ? ' selected' : '') +
                (block.completed ? ' completed' : '') +
                (past ? ' past' : '')
              }
              onClick={() => onSelect(block.id)}
            >
              <div className="task-color-swatch" style={{ background: block.color }} />
              <div className="task-body">
                <div className="task-label">
                  {block.label}
                  {block.recurring && <span className="task-recur-badge">{'↻'}</span>}
                </div>
                <div className="task-time">{formatBlockTimeRange(block)}</div>
              </div>
              <div className="task-actions">
                <button
                  className="task-btn"
                  title={block.completed ? 'Mark incomplete' : 'Mark complete'}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleBlockCompleted(calData, date, block.id);
                  }}
                >
                  {block.completed ? '↺' : '✓'}
                </button>
              </div>
            </div>

            {block.subtasks.length > 0 && (
              <div className="task-subtasks">
                {block.subtasks.map((task) => (
                  <div
                    key={task.id}
                    className={'schedule-subtask-item' + (task.completed ? ' completed' : '')}
                  >
                    <button
                      className="schedule-subtask-toggle"
                      title={task.completed ? 'Mark sub-task incomplete' : 'Mark sub-task complete'}
                      onClick={() => void toggleSubtaskCompleted(calData, date, block.id, task.id)}
                    >
                      {task.completed ? '↺' : '✓'}
                    </button>
                    <div className="schedule-subtask-label">{task.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
