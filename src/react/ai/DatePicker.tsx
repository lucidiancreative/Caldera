import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dateKey, getTodayKey, stepMonthKey, MONTH_LABELS, MONTH_TAB_LABELS, WEEKDAY_LABELS } from '../util/format';

// A themed popup calendar that reads/writes a 'YYYY-MM-DD' string, matching the native
// date input it replaces. The popup is portaled to <body> so it escapes the AI modal's
// backdrop-filter containing block and overflow clipping (skin-glass gives the modal both).
interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Compact "Jul 18, 2026" label for the trigger button — the full weekday form is too wide here.
function formatButtonDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return `${MONTH_TAB_LABELS[month - 1]} ${day}, ${year}`;
}

// Single-letter weekday headers so all seven columns fit the 240px popup.
const WEEKDAY_INITIALS = WEEKDAY_LABELS.map((label) => label[0]);

export function DatePicker({ value, onChange, placeholder = 'Any date' }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewKey, setViewKey] = useState(value || getTodayKey());
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    setViewKey(value || getTodayKey());
    setOpen(true);
  }

  // Anchor the fixed popup to the trigger, flipping above / shifting inward when it would
  // spill past the viewport edge.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = 240;
      const height = popupRef.current?.offsetHeight || 320;
      const gap = 6;
      let top = rect.bottom + gap;
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - gap - height);
      let left = Math.min(rect.left, window.innerWidth - 8 - width);
      left = Math.max(8, left);
      setPos({ top, left });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const todayKey = getTodayKey();
  const [viewYear, viewMonth] = viewKey.split('-').map(Number);
  const monthIndex = viewMonth - 1;
  // 42 cells (6 weeks) starting from the Sunday on/before the 1st, so leading/trailing
  // days spill into the greyed-out other-month rows.
  const gridStart = new Date(viewYear, monthIndex, 1 - new Date(viewYear, monthIndex, 1).getDay());

  function selectDay(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={'ai-date-btn' + (value ? ' has-value' : '')}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span className="ai-date-btn-text">{value ? formatButtonDate(value) : placeholder}</span>
        <svg className="ai-date-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && createPortal(
        <div ref={popupRef} className="ai-datepicker" style={{ top: pos.top, left: pos.left }}>
          <div className="ai-datepicker-header">
            <button type="button" className="ai-dp-nav" onClick={() => setViewKey(stepMonthKey(viewKey, -1))}>&#8249;</button>
            <span>{MONTH_LABELS[monthIndex]} {viewYear}</span>
            <button type="button" className="ai-dp-nav" onClick={() => setViewKey(stepMonthKey(viewKey, 1))}>&#8250;</button>
          </div>

          <div className="ai-datepicker-weekdays">
            {WEEKDAY_INITIALS.map((initial, index) => <span key={index}>{initial}</span>)}
          </div>

          <div className="ai-datepicker-days">
            {Array.from({ length: 42 }, (_, index) => {
              const date = new Date(gridStart);
              date.setDate(gridStart.getDate() + index);
              const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
              const className = [
                'ai-dp-day',
                date.getMonth() !== monthIndex ? 'other-month' : '',
                key === todayKey ? 'today' : '',
                key === value ? 'selected' : '',
              ].filter(Boolean).join(' ');
              return (
                <button type="button" key={key} className={className} onClick={() => selectDay(key)}>
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="ai-datepicker-footer">
            <button type="button" className="ai-btn-secondary" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
            <button type="button" className="ai-btn-secondary" onClick={() => selectDay(todayKey)}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
