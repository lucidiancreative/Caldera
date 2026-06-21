// One adaptive date nav shared by all three lenses. The arrows step by month, day,
// or week depending on the active mode, and the label re-formats to match. Sits just
// above the main UI and is the only date control now that the top month strip is gone.
import { formatDisplayDate, formatMonthYear, formatWeekRange, getTodayKey, stepDateKey, stepMonthKey } from '../util/format';

export type CalMode = 'month' | 'week' | 'day';

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

  const label =
    mode === 'month' ? formatMonthYear(year, month - 1)
    : mode === 'week' ? formatWeekRange(date)
    : formatDisplayDate(date);

  const labels = {
    month: { prev: 'Previous month', next: 'Next month' },
    week: { prev: 'Previous week', next: 'Next week' },
    day: { prev: 'Previous day', next: 'Next day' },
  }[mode];

  function step(direction: number) {
    if (mode === 'month') onChange(stepMonthKey(date, direction));
    else if (mode === 'week') onChange(stepDateKey(date, direction * 7));
    else onChange(stepDateKey(date, direction));
  }

  return (
    <div className="react-schedule-datenav">
      <button className="nav-arrow" title={labels.prev} onClick={() => step(-1)}>&#8249;</button>
      <div className="react-schedule-datecopy">
        <span className="react-schedule-datelabel">{label}</span>
      </div>
      <button className="nav-arrow" title={labels.next} onClick={() => step(1)}>&#8250;</button>
      <button
        className="react-schedule-today"
        title="Jump to today"
        aria-label="Jump to today"
        onClick={() => onChange(getTodayKey())}
      >
        {/* Calendar with a dot on today (Lucide-style). currentColor inherits the button's color. */}
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
          <circle cx="12" cy="16" r="1.5" />
        </svg>
      </button>
    </div>
  );
}
