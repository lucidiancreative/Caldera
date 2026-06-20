import { useState } from 'react';
import { useCalData } from '../store/calStore';
import { getInboxTasks } from '../store/selectors';
import { addInboxTask, toggleInboxTask, deleteInboxTask } from '../store/inboxActions';
import { TASK_DND_MIME } from './taskDnd';

// The quick-add inbox above the day's scheduled blocks. Typing a name and pressing
// Enter adds a task and clears the field without unmounting it, so focus stays put for
// the next one (type, Enter, type, Enter…). Tasks have no time yet — a later drag onto
// the timeline turns one into a scheduled block.
export function TaskInbox() {
  const calData = useCalData();
  const tasks = getInboxTasks(calData);
  const [draft, setDraft] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    void addInboxTask(calData, value);
    setDraft('');
  }

  return (
    <>
      <form className="task-add" onSubmit={submit}>
        <input
          className="task-add-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="+ Add task"
          aria-label="Add task"
        />
      </form>

      {tasks.length > 0 && (
        <div className="task-inbox-list">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={'inbox-item' + (task.completed ? ' completed' : '')}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(TASK_DND_MIME, task.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <button
                className="inbox-check"
                title={task.completed ? 'Mark incomplete' : 'Mark complete'}
                onClick={() => void toggleInboxTask(calData, task.id)}
              >
                {task.completed ? <>&#8634;</> : <>&#10003;</>}
              </button>
              <div className="inbox-label">{task.label}</div>
              <button
                className="inbox-del"
                title="Delete task"
                onClick={() => void deleteInboxTask(calData, task.id)}
              >
                &#10005;
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
