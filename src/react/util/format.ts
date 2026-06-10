// Pure date/time formatters mirroring the vanilla renderer so the React Schedule
// view displays times and dates identically. Kept tiny and dependency-free.
import type { AmPm } from '../../types';

export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function getTodayKey(): string {
  const today = new Date();
  return dateKey(today.getFullYear(), today.getMonth(), today.getDate());
}

export function stepDateKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const dt = new Date(year, month - 1, day + delta);
  return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function formatDisplayDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
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
