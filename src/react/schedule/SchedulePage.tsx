import { useCallback, useEffect, useState } from 'react';
import { TaskInbox } from './TaskInbox';
import { TaskList } from './TaskList';
import { TimelineMode } from './TimelineMode';
import { SubtaskSection } from './SubtaskSection';
import { DailyMode } from './DailyMode';
import { BlockEditor, type EditorTarget } from './BlockEditor';
import { ScheduleNav, type CalMode } from './ScheduleNav';
import { CalendarView, type CellView } from '../calendar/CalendarView';
import { LensLayout } from '../lens/LensLayout';
import type { LensId } from '../lens/lenses';
import { useCalData } from '../store/calStore';
import { scheduleInboxTask } from '../store/inboxActions';
import { getInboxTasks, getScheduleBlocksForDate } from '../store/selectors';
import { absoluteMinutesToBlockTimes } from './timeline';
import { useCalderaTabs } from '../tabs/useCalderaTabs';
import { MONTH_TAB_LABELS, getTodayKey, withMonth } from '../util/format';

type SelectedOccurrence = { date: string; blockId: string };

const SELECTION_STORAGE_KEY = 'caldera.schedule.selectedBlock.v1';
const CELL_VIEW_STORAGE_KEY = 'caldera.calendar.cellView.v1';
const DEFAULT_SELECTION_SCOPE = 'default';

// The Month grid's Images/Tasks toggle is a single global preference (all cells share it),
// so it lives in one localStorage key rather than being scoped per tab like the selection.
function readStoredCellView(): CellView {
  try {
    return window.localStorage.getItem(CELL_VIEW_STORAGE_KEY) === 'task' ? 'task' : 'image';
  } catch {
    return 'image';
  }
}

function writeStoredCellView(view: CellView): void {
  try {
    window.localStorage.setItem(CELL_VIEW_STORAGE_KEY, view);
  } catch {
    // Cell-view persistence is a convenience; the calendar works without storage.
  }
}

function selectionScope(activeId: string): string {
  return activeId || window.calderaTabs?.activeId() || DEFAULT_SELECTION_SCOPE;
}

function isSelectedOccurrence(value: unknown): value is SelectedOccurrence {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SelectedOccurrence>;
  return typeof candidate.date === 'string' && typeof candidate.blockId === 'string';
}

function readStoredSelection(activeId: string): SelectedOccurrence | null {
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[selectionScope(activeId)];
    return isSelectedOccurrence(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredSelection(activeId: string, selection: SelectedOccurrence | null): void {
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const scope = selectionScope(activeId);
    if (selection) parsed[scope] = selection;
    else delete parsed[scope];
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Selection persistence is a convenience; the schedule remains usable without storage.
  }
}

export function SchedulePage({
  externalDate,
  initialDate,
  mode,
  onModeChange,
  onOpenDay,
  onHoverDateChange,
  onOpenAi,
  lens,
  onSelectLens,
}: {
  externalDate?: string;
  initialDate?: string;
  mode: CalMode;
  onModeChange: (mode: CalMode) => void;
  onOpenDay: (key: string) => void;
  onHoverDateChange: (key: string | null) => void;
  onOpenAi: () => void;
  lens: LensId;
  onSelectLens: (lens: LensId) => void;
}) {
  const calData = useCalData();
  const { activeId } = useCalderaTabs();
  const [internalDate, setInternalDate] = useState(externalDate ?? initialDate ?? getTodayKey());
  const [selection, setSelectionState] = useState<SelectedOccurrence | null>(() => readStoredSelection(activeId));
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [cellView, setCellViewState] = useState<CellView>(() => readStoredCellView());
  const date = externalDate ?? internalDate;
  const [year, month] = date.split('-').map(Number);
  const selectionIsValid = !!selection && getScheduleBlocksForDate(calData, selection.date).some((block) => block.id === selection.blockId);
  const activeSelection = selectionIsValid ? selection : null;
  const selectedBlockId = activeSelection?.date === date ? activeSelection.blockId : null;

  function setSelection(nextSelection: SelectedOccurrence | null) {
    setSelectionState(nextSelection);
    writeStoredSelection(activeId, nextSelection);
  }

  const clearSelection = useCallback(() => {
    setSelectionState(null);
    writeStoredSelection(activeId, null);
  }, [activeId]);

  useEffect(() => {
    setSelectionState(readStoredSelection(activeId));
  }, [activeId]);

  useEffect(() => {
    if (externalDate !== undefined) return;
    window.calderaView?.setScheduleDate(date);
  }, [date, externalDate]);

  useEffect(() => {
    if (!selection || selectionIsValid) return;
    setSelectionState(null);
    writeStoredSelection(activeId, null);
  }, [activeId, selection, selectionIsValid]);

  function focusDate(nextDate: string, options?: { preserveSelection?: boolean }) {
    if (externalDate === undefined) setInternalDate(nextDate);
    if (!options?.preserveSelection) setSelection(null);
    setEditor(null);
    if (window.calderaView?.scheduleDate() !== nextDate) {
      window.calderaView?.setScheduleDate(nextDate);
    }
  }

  function selectMode(next: CalMode) {
    onModeChange(next);
  }

  async function handleScheduleTask(
    taskId: string,
    draft: { date: string; startMin: number; endMin: number; ampm: 'AM' | 'PM' },
  ) {
    const blockId = await scheduleInboxTask(calData, taskId, draft.date, draft.startMin, draft.endMin, draft.ampm);
    if (!blockId) return;
    focusDate(draft.date, { preserveSelection: true });
    setSelection({ date: draft.date, blockId }); // select the new block so it can be adjusted right away
  }

  function setCellView(next: CellView) {
    setCellViewState(next);
    writeStoredCellView(next);
  }

  // Dropping an inbox task on a Month day-cell: flip every cell to Task view (so the new block
  // is visible where it landed), focus that day, and open the block editor seeded with the
  // task's label and a default 9-10 AM slot. Saving consumes the task; cancelling keeps it.
  function handleTaskDropOnDay(dropDate: string, taskId: string) {
    const task = getInboxTasks(calData).find((entry) => entry.id === taskId);
    if (!task) return;
    setCellView('task');
    focusDate(dropDate);
    const seed = absoluteMinutesToBlockTimes(9 * 60, 10 * 60);
    setEditor({
      mode: 'create',
      date: dropDate,
      startMin: seed.startMin,
      endMin: seed.endMin,
      ampm: seed.ampm,
      label: task.label,
      sourceTaskId: taskId,
    });
  }

  return (
    <LensLayout
      lens={lens}
      onSelectLens={onSelectLens}
      sidebar={
        <>
          <TaskInbox />
          <TaskList
            date={date}
            selectedBlockId={selectedBlockId}
            onSelect={(blockId) => setSelection({ date, blockId })}
            onEdit={(block) => setEditor({ mode: 'edit', date, block })}
          />
        </>
      }
      main={
        <>
          {/* Calendar controls stack the date nav directly above the centered Jan-Dec
              quick-jump strip, with view toggles anchored on the lower right. */}
          <div className="react-schedule-topbar">
            <div className="react-schedule-navrow">
              <ScheduleNav mode={mode} date={date} onChange={(key) => focusDate(key)} />
            </div>
            <div className="react-schedule-striprow">
              {mode === 'month' ? (
                <div className="react-schedule-cellview" role="group" aria-label="Day cell contents">
                  <button className={'schedule-mode-btn' + (cellView === 'task' ? ' active' : '')} onClick={() => setCellView('task')}>Tasks</button>
                  <button className={'schedule-mode-btn' + (cellView === 'image' ? ' active' : '')} onClick={() => setCellView('image')}>Events</button>
                  <button className="schedule-import-btn" title="Event Import" aria-label="Event Import" onClick={onOpenAi}>
                    {/* Lucide calendar-plus — opens the AI event import */}
                    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 2v4" />
                      <path d="M16 2v4" />
                      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
                      <path d="M3 10h18" />
                      <path d="M16 19h6" />
                      <path d="M19 16v6" />
                    </svg>
                  </button>
                </div>
              ) : (
                <span className="react-schedule-stripspacer" aria-hidden="true" />
              )}
              <div className="react-schedule-monthtabs" role="group" aria-label="Month quick jump">
                {MONTH_TAB_LABELS.map((label, index) => (
                  <button
                    key={label}
                    className={'month-tab' + (index === month - 1 ? ' active' : '')}
                    aria-current={index === month - 1 ? 'date' : undefined}
                    onClick={() => focusDate(withMonth(date, index))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="react-schedule-modetoggle">
                <button className={'schedule-mode-btn' + (mode === 'month' ? ' active' : '')} onClick={() => selectMode('month')}>Month</button>
                <button className={'schedule-mode-btn' + (mode === 'week' ? ' active' : '')} onClick={() => selectMode('week')}>Week</button>
                <button className={'schedule-mode-btn' + (mode === 'day' ? ' active' : '')} onClick={() => selectMode('day')}>Day</button>
              </div>
            </div>
          </div>

          <div className="react-schedule-canvas">
            {mode === 'month' ? (
              <CalendarView
                month={month - 1}
                year={year}
                cellView={cellView}
                onOpenDay={onOpenDay}
                onHoverDateChange={onHoverDateChange}
                onTaskDrop={handleTaskDropOnDay}
              />
            ) : mode === 'week' ? (
              <div className="react-schedule-week">
                <TimelineMode
                  date={date}
                  selection={activeSelection}
                  onFocusDate={focusDate}
                  onSelect={(nextSelection) => {
                    setSelection(nextSelection);
                    focusDate(nextSelection.date, { preserveSelection: true });
                  }}
                  onClearSelection={clearSelection}
                  onCreate={(draft) => {
                    setSelection(null);
                    focusDate(draft.date);
                    setEditor({ mode: 'create', date: draft.date, startMin: draft.startMin, endMin: draft.endMin, ampm: draft.ampm });
                  }}
                  onScheduleTask={handleScheduleTask}
                />
                <SubtaskSection selection={activeSelection} />
              </div>
            ) : (
              <DailyMode
                date={date}
                selectedBlockId={selectedBlockId}
                onSelect={(blockId) => setSelection({ date, blockId })}
                onCreate={(draft) => {
                  setSelection(null);
                  setEditor({ mode: 'create', date, ...draft });
                }}
              />
            )}
          </div>
        </>
      }
    >
      {editor && <BlockEditor target={editor} onClose={() => setEditor(null)} />}
    </LensLayout>
  );
}
