// Pure date/time formatters mirroring the vanilla renderer so the React Schedule
// view displays times and dates identically. Kept tiny and dependency-free.
import type { AmPm } from '../../types';

export const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
export const MONTH_TAB_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function getTodayKey(): string {
  const today = new Date();
  return dateKey(today.getFullYear(), today.getMonth(), today.getDate());
}

export function stepDateKey(key: string, delta: number): string {
  const dt = parseDateKey(key);
  dt.setDate(dt.getDate() + delta);
  return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function getWeekStartKey(key: string): string {
  const dt = parseDateKey(key);
  dt.setDate(dt.getDate() - dt.getDay());
  return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function getWeekDateKeys(key: string): string[] {
  const start = getWeekStartKey(key);
  return Array.from({ length: 7 }, (_, index) => stepDateKey(start, index));
}

export function formatDisplayDate(key: string): string {
  return parseDateKey(key).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function formatWeekdayLabel(key: string): string {
  return parseDateKey(key).toLocaleDateString('en-US', { weekday: 'short' });
}

export function formatMonthDayLabel(key: string): string {
  return parseDateKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatWeekRange(key: string): string {
  const start = parseDateKey(getWeekStartKey(key));
  const end = parseDateKey(stepDateKey(getWeekStartKey(key), 6));
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric',
  });
  const yearSuffix = start.getFullYear() === end.getFullYear() ? `, ${end.getFullYear()}` : '';
  return `${startLabel} - ${endLabel}${yearSuffix}`;
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_LABELS[month]} ${year}`;
}

export function formatTime12h(time: string): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}

function formatClockMinutes(min: number, ampm = ''): string {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = min % 60;
  const base = `${h}:${String(m).padStart(2, '0')}`;
  return ampm ? `${base} ${ampm}` : base;
}

// An end time before the start wraps into the other half of the day (AM↔PM).
function getBlockEndAmPm(block: { startMin: number; endMin: number; ampm: AmPm }): AmPm {
  return block.endMin < block.startMin ? (block.ampm === 'AM' ? 'PM' : 'AM') : block.ampm;
}

export function formatBlockTimeRange(block: { startMin: number; endMin: number; ampm: AmPm }): string {
  return `${formatClockMinutes(block.startMin, block.ampm)} – ${formatClockMinutes(block.endMin, getBlockEndAmPm(block))}`;
}
