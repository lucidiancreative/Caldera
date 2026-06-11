// React Schedule page shell: shared header (date nav + Today + mode toggle) over a
// persistent task list and a mode canvas. Timeline and Daily modes fill the canvas
// in later steps; for now it shows a placeholder. Not yet routed from the Schedule
// tab — built and verified in isolation until it reaches parity with the vanilla view.
import { useEffect, useState } from 'react';
import { TaskList } from './TaskList';
import { TimelineMode } from './TimelineMode';
import { DailyMode } from './DailyMode';
import { BlockEditor, type EditorTarget } from './BlockEditor';
import { formatDisplayDate, getTodayKey, stepDateKey } from '../util/format';

type ScheduleMode = 'daily' | 'timeline';

export function SchedulePage({
  externalDate,
  initialDate,
  initialMode,
}: {
  externalDate?: string;
  initialDate?: string;
  initialMode?: ScheduleMode;
}) {
  const [date, setDate] = useState(externalDate ?? initialDate ?? getTodayKey());
  const [mode, setMode] = useState<ScheduleMode>(initialMode ?? 'timeline');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  useEffect(() => {
    if (!externalDate || externalDate === date) return;
    setDate(externalDate);
    setSelectedBlockId(null);
    setEditor(null);
  }, [date, externalDate]);

  useEffect(() => { window.calderaView?.setScheduleDate(date); }, [date]);
  useEffect(() => { setSelectedBlockId(null); }, [date]);

  return (
    <div className="react-schedule">
      <div className="react-schedule-datenav">
        <button className="nav-arrow" title="Previous day" onClick={() => setDate(stepDateKey(date, -1))}>‹</button>
        <span className="react-schedule-datelabel">{formatDisplayDate(date)}</span>
        <button className="nav-arrow" title="Next day" onClick={() => setDate(stepDateKey(date, 1))}>›</button>
        <button className="react-schedule-today" onClick={() => setDate(getTodayKey())}>Today</button>
      </div>

      <div className="react-schedule-body">
        <TaskList
          date={date}
          selectedBlockId={selectedBlockId}
          onSelect={setSelectedBlockId}
          onEdit={(block) => setEditor({ mode: 'edit', date, block })}
        />

        <div className="react-schedule-main">
          <div className="react-schedule-modetoggle">
            <button
              className={'schedule-mode-btn' + (mode === 'daily' ? ' active' : '')}
              onClick={() => setMode('daily')}
            >Daily</button>
            <button
              className={'schedule-mode-btn' + (mode === 'timeline' ? ' active' : '')}
              onClick={() => setMode('timeline')}
            >Timeline</button>
          </div>
          <div className="react-schedule-canvas">
            {mode === 'timeline' ? (
              <TimelineMode
                date={date}
                selectedBlockId={selectedBlockId}
                onSelect={setSelectedBlockId}
                onCreate={(draft) => setEditor({ mode: 'create', date, ...draft })}
              />
            ) : (
              <DailyMode
                date={date}
                selectedBlockId={selectedBlockId}
                onSelect={setSelectedBlockId}
                onCreate={(draft) => setEditor({ mode: 'create', date, ...draft })}
              />
            )}
          </div>
        </div>
      </div>

      {editor && <BlockEditor target={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}
