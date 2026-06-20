import { useEffect, useState } from 'react';
import { useCalData } from '../store/calStore';
import { getScheduleBlocksForDate } from '../store/selectors';
import { addSubtask, deleteSubtask, toggleSubtaskCompleted, updateSubtaskNotes } from '../store/actions';
import { formatBlockTimeRange } from '../util/format';

interface SubtaskSectionProps {
  selection: { date: string; blockId: string } | null;
}

// The sub-tasks for the block selected in the Week view, shown in their own section
// beneath the timeline (so the timeline can shrink to its rows and hand the reclaimed
// space here). Selecting a block — in the left list or by clicking a timeline bar —
// fills this in; with nothing selected it prompts the user to pick one.
export function SubtaskSection({ selection }: SubtaskSectionProps) {
  const calData = useCalData();
  const [draft, setDraft] = useState('');
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  // Clear the draft when the selected block changes so it doesn't leak across blocks.
  useEffect(() => {
    setDraft('');
    setSelectedSubtaskId(null);
    setNotesDraft('');
  }, [selection?.blockId]);

  const block = selection
    ? getScheduleBlocksForDate(calData, selection.date).find((entry) => entry.id === selection.blockId) ?? null
    : null;

  const selectedSubtask = selectedSubtaskId
    ? block?.subtasks.find((task) => task.id === selectedSubtaskId) ?? null
    : null;

  useEffect(() => {
    if (!block?.subtasks.length) {
      setSelectedSubtaskId(null);
      return;
    }
    if (!selectedSubtaskId || !block.subtasks.some((task) => task.id === selectedSubtaskId)) {
      setSelectedSubtaskId(block.subtasks[0].id);
    }
  }, [block?.id, block?.subtasks, selectedSubtaskId]);

  useEffect(() => {
    setNotesDraft(selectedSubtask?.notes || '');
  }, [selectedSubtask?.id, selectedSubtask?.notes]);

  if (!selection || !block) {
    return (
      <div className="schedule-subtask-section">
        <div className="schedule-subtask-section-empty">Select a block to view its sub-tasks.</div>
      </div>
    );
  }

  const { date, blockId } = selection;

  function saveNotes() {
    if (!selectedSubtask) return;
    void updateSubtaskNotes(date, blockId, selectedSubtask.id, notesDraft);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    void addSubtask(date, blockId, value);
    setDraft('');
  }

  return (
    <div className="schedule-subtask-section">
      <div className="schedule-subtask-section-head">
        <div className="schedule-subtask-section-title">{block.label}</div>
        <div className="schedule-subtask-section-time">{formatBlockTimeRange(block)}</div>
      </div>

      <div className="schedule-subtask-section-content">
        <div className="schedule-subtask-list-pane">
          <div className="schedule-subtask-section-body">
            {block.subtasks.length === 0 ? (
              <div className="schedule-subtask-section-empty">No sub-tasks yet. Add one below.</div>
            ) : (
              block.subtasks.map((task) => (
                <div
                  key={task.id}
                  className={
                    'schedule-subtask-item' +
                    (task.completed ? ' completed' : '') +
                    (task.id === selectedSubtaskId ? ' selected' : '')
                  }
                  onClick={() => {
                    saveNotes();
                    setSelectedSubtaskId(task.id);
                  }}
                >
                  <button
                    className="schedule-subtask-toggle"
                    title={task.completed ? 'Mark sub-task incomplete' : 'Mark sub-task complete'}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleSubtaskCompleted(calData, date, blockId, task.id);
                    }}
                  >
                    {task.completed ? <>&#8634;</> : <>&#10003;</>}
                  </button>
                  <div className="schedule-subtask-label">{task.label}</div>
                  <button
                    className="schedule-subtask-delete"
                    title="Delete sub-task"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteSubtask(date, blockId, task.id);
                    }}
                  >
                    &#10005;
                  </button>
                </div>
              ))
            )}
          </div>

          <form className="schedule-subtask-section-add" onSubmit={submit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a sub-task"
              aria-label="Add a sub-task"
            />
            <button className="task-btn" type="submit" title="Add sub-task">+</button>
          </form>
        </div>

        <div className="schedule-subtask-notes-pane">
          <div className="schedule-subtask-notes-title">Sub-task notes</div>
          {selectedSubtask ? (
            <textarea
              className="schedule-subtask-notes-input"
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              onBlur={saveNotes}
              placeholder="Add notes for this sub-task"
              aria-label={`Notes for ${selectedSubtask.label}`}
            />
          ) : (
            <div className="schedule-subtask-section-empty">Select a sub-task to write notes.</div>
          )}
        </div>
      </div>
    </div>
  );
}
