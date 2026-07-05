// One adaptive date nav shared by all three lenses. The arrows step by month, day,
// or week depending on the active mode, and the label re-formats to match. Sits just
// above the main UI and is the only date control now that the top month strip is gone.
import { useEffect, useRef, useState } from 'react';
import { formatDisplayDate, formatMonthYear, formatWeekRange, getTodayKey, stepDateKey, stepMonthKey, withYear } from '../util/format';

export type CalMode = 'month' | 'week' | 'day';

// Years offered on each side of the viewed year in the picker dropdown.
const YEAR_SPAN = 6;

export function ScheduleNav({
  mode,
  date,
  onChange,
}: {
  mode: CalMode;
  date: string;
  onChange: (key: string) => void;
}) {
  const [year, month] = date.split('-').map(Number);
  const [yearOpen, setYearOpen] = useState(false);
  const yearRef = useRef<HTMLDivElement>(null);

  // Close the year dropdown on an outside click or Escape.
  useEffect(() => {
    if (!yearOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (yearRef.current && !yearRef.current.contains(event.target as Node)) setYearOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setYearOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [yearOpen]);

  const label =
    mode === 'month' ? formatMonthYear(year, month - 1)
    : mode === 'week' ? formatWeekRange(date)
    : formatDisplayDate(date);

  const labels = {
    month: { prev: 'Previous month', next: 'Next month' },
    week: { prev: 'Previous week', next: 'Next week' },
    day: { prev: 'Previous day', next: 'Next day' },
  }[mode];

  const years = Array.from({ length: YEAR_SPAN * 2 + 1 }, (_, i) => year - YEAR_SPAN + i);

  function step(direction: number) {
    if (mode === 'month') onChange(stepMonthKey(date, direction));
    else if (mode === 'week') onChange(stepDateKey(date, direction * 7));
    else onChange(stepDateKey(date, direction));
  }

  function pickYear(nextYear: number) {
    setYearOpen(false);
    onChange(withYear(date, nextYear));
  }

  return (
    <div className="react-schedule-datenav">
      <button
        className="react-schedule-today"
        title="Return to today"
        aria-label="Return to today"
        onClick={() => onChange(getTodayKey())}
      >
        {/* Lucide rotate-ccw — a circular return arrow, snaps the view back to today. */}
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
      <div className="react-schedule-yearpicker" ref={yearRef}>
        <button
          className="react-schedule-yearbtn"
          title="Select year"
          aria-label="Select year"
          aria-haspopup="listbox"
          aria-expanded={yearOpen}
          onClick={() => setYearOpen((open) => !open)}
        >
          {/* Lucide calendar-days — opens the year dropdown. */}
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
            <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
          </svg>
        </button>
        {yearOpen && (
          <ul className="react-schedule-yearmenu" role="listbox" aria-label="Year">
            {years.map((y) => (
              <li key={y}>
                <button
                  type="button"
                  className={'react-schedule-yearopt' + (y === year ? ' active' : '')}
                  role="option"
                  aria-selected={y === year}
                  onClick={() => pickYear(y)}
                >
                  {y}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="nav-arrow" title={labels.prev} onClick={() => step(-1)}>&#8249;</button>
      <div className="react-schedule-datecopy">
        <span className="react-schedule-datelabel">{label}</span>
      </div>
      <button className="nav-arrow" title={labels.next} onClick={() => step(1)}>&#8250;</button>
    </div>
  );
}
