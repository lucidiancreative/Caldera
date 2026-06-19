import { useEffect, useState } from 'react';
import { TaskList } from './TaskList';
import { TimelineMode } from './TimelineMode';
import { DailyMode } from './DailyMode';
import { BlockEditor, type EditorTarget } from './BlockEditor';
import { ScheduleNav, type CalMode } from './ScheduleNav';
import { CalendarView } from '../calendar/CalendarView';
import { MONTH_TAB_LABELS, getTodayKey, withMonth } from '../util/format';

type SelectedOccurrence = { date: string; blockId: string };

export function SchedulePage({
  externalDate,
  initialDate,
  mode,
  onModeChange,
  onOpenDay,
  onHoverDateChange,
}: {
  externalDate?: string;
  initialDate?: string;
  mode: CalMode;
  onModeChange: (mode: CalMode) => void;
  onOpenDay: (key: string) => void;
  onHoverDateChange: (key: string | null) => void;
}) {
  const [internalDate, setInternalDate] = useState(externalDate ?? initialDate ?? getTodayKey());
  const [selection, setSelection] = useState<SelectedOccurrence | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const date = externalDate ?? internalDate;
  const [year, month] = date.split('-').map(Number);

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

  function selectMode(next: CalMode) {
    onModeChange(next);
    setSelection(null);
  }

  const selectedBlockId = selection?.date === date ? selection.blockId : null;

  return (
    <div className="react-schedule">
      <div className="react-schedule-body">
        <TaskList
          date={date}
          selectedBlockId={selectedBlockId}
          onSelect={(blockId) => setSelection({ date, blockId })}
          onEdit={(block) => setEditor({ mode: 'edit', date, block })}
        />

        <div className="react-schedule-main">
          {/* Control row lives in the calendar column so the toggles line up with the
              calendar's left edge, the nav centers over it, and the months sit at its right. */}
          <div className="react-schedule-topbar">
            <div className="react-schedule-modetoggle">
              <button className={'schedule-mode-btn' + (mode === 'month' ? ' active' : '')} onClick={() => selectMode('month')}>Month</button>
              <button className={'schedule-mode-btn' + (mode === 'week' ? ' active' : '')} onClick={() => selectMode('week')}>Week</button>
              <button className={'schedule-mode-btn' + (mode === 'day' ? ' active' : '')} onClick={() => selectMode('day')}>Day</button>
            </div>
            <ScheduleNav mode={mode} date={date} onChange={(key) => focusDate(key)} />
            <div className="react-schedule-monthtabs">
              {MONTH_TAB_LABELS.map((label, index) => (
                <button
                  key={label}
                  className={'month-tab' + (index === month - 1 ? ' active' : '')}
                  onClick={() => focusDate(withMonth(date, index))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="react-schedule-canvas">
            {mode === 'month' ? (
              <CalendarView
                month={month - 1}
                year={year}
                onOpenDay={onOpenDay}
                onHoverDateChange={onHoverDateChange}
              />
            ) : mode === 'week' ? (
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
