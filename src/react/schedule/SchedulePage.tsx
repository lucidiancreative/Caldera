import { useEffect, useState } from 'react';
import { TaskList } from './TaskList';
import { TimelineMode } from './TimelineMode';
import { DailyMode } from './DailyMode';
import { BlockEditor, type EditorTarget } from './BlockEditor';
import { formatDisplayDate, formatWeekRange, getTodayKey, stepDateKey } from '../util/format';

type ScheduleMode = 'daily' | 'timeline';
type SelectedOccurrence = { date: string; blockId: string };

export function SchedulePage({
  externalDate,
  initialDate,
  initialMode,
}: {
  externalDate?: string;
  initialDate?: string;
  initialMode?: ScheduleMode;
}) {
  const [internalDate, setInternalDate] = useState(externalDate ?? initialDate ?? getTodayKey());
  const [mode, setMode] = useState<ScheduleMode>(initialMode ?? 'timeline');
  const [selection, setSelection] = useState<SelectedOccurrence | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const date = externalDate ?? internalDate;

  useEffect(() => {
    if (externalDate !== undefined) return;
    window.calderaView?.setScheduleDate(date);
  }, [date, externalDate]);

  function focusDate(nextDate: string, options?: { preserveSelection?: boolean }) {
    if (externalDate === undefined) setInternalDate(nextDate);
    if (!options?.preserveSelection) setSelection(null);
    setEditor(null);
    if (window.calderaView?.scheduleDate() !== nextDate) {
      window.calderaView?.setScheduleDate(nextDate);
    }
  }

  const scheduleLabel = mode === 'timeline' ? formatWeekRange(date) : formatDisplayDate(date);
  const selectedBlockId = selection?.date === date ? selection.blockId : null;

  return (
    <div className="react-schedule">
      <div className="react-schedule-datenav">
        <button className="nav-arrow" title="Previous day" onClick={() => focusDate(stepDateKey(date, -1))}>&#8249;</button>
        <div className="react-schedule-datecopy">
          <span className="react-schedule-datelabel">{scheduleLabel}</span>
          {mode === 'timeline' && (
            <span className="react-schedule-datesub">Focused day: {formatDisplayDate(date)}</span>
          )}
        </div>
        <button className="nav-arrow" title="Next day" onClick={() => focusDate(stepDateKey(date, 1))}>&#8250;</button>
        <button className="react-schedule-today" onClick={() => focusDate(getTodayKey())}>Today</button>
      </div>

      <div className="react-schedule-body">
        <TaskList
          date={date}
          selectedBlockId={selectedBlockId}
          onSelect={(blockId) => setSelection({ date, blockId })}
          onEdit={(block) => setEditor({ mode: 'edit', date, block })}
        />

        <div className="react-schedule-main">
          <div className="react-schedule-modetoggle">
            <button
              className={'schedule-mode-btn' + (mode === 'daily' ? ' active' : '')}
              onClick={() => {
                setMode('daily');
                setSelection(null);
              }}
            >Daily</button>
            <button
              className={'schedule-mode-btn' + (mode === 'timeline' ? ' active' : '')}
              onClick={() => {
                setMode('timeline');
                setSelection(null);
              }}
            >Timeline</button>
          </div>
          <div className="react-schedule-canvas">
            {mode === 'timeline' ? (
              <TimelineMode
                date={date}
                selection={selection}
                onFocusDate={focusDate}
                onSelect={(nextSelection) => {
                  setSelection(nextSelection);
                  focusDate(nextSelection.date, { preserveSelection: true });
                }}
                onCreate={(draft) => {
                  setSelection(null);
                  focusDate(draft.date);
                  setEditor({ mode: 'create', date: draft.date, startMin: draft.startMin, endMin: draft.endMin, ampm: draft.ampm });
                }}
              />
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
        </div>
      </div>

      {editor && <BlockEditor target={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}
