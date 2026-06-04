import type { AiEvent, AiImportResult } from '../types';

type DebugLogger = (...args: unknown[]) => void;

const MAX_TITLE_LEN = 200;
const MAX_NOTES_LEN = 10_000;
const MAX_URL_LEN = 2_000;

export function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr + 'T00:00:00');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

export function sanitizeSourceUrl(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return raw.slice(0, MAX_URL_LEN);
  } catch {
    return '';
  }
}

export function isLikelyHomepage(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    return pathname === '/' || pathname === '' || /^\/(events|shows|calendar|listings)\/?$/i.test(pathname);
  } catch {
    return false;
  }
}

export function tryParseJsonArray(candidate: string): unknown[] | null {
  try {
    return JSON.parse(candidate) as unknown[];
  } catch {}

  for (const suffix of ['"}]', '}]', ']']) {
    try {
      return JSON.parse(candidate + suffix) as unknown[];
    } catch {}
  }

  return null;
}

export function parseEventText(
  text: string,
  source: string,
  options: { debugLog?: DebugLogger } = {},
): AiImportResult {
  const debugLog = options.debugLog;
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const completeMatch = stripped.match(/\[[\s\S]*\]/);
  const partialMatch = stripped.match(/\[[\s\S]*/);
  const candidate = completeMatch?.[0] ?? partialMatch?.[0];

  if (!candidate) {
    console.warn(`[ai-import] ${source}: no JSON array found in response`);
    return { events: [] };
  }

  const raw = tryParseJsonArray(candidate);
  if (!raw) {
    console.error(`[ai-import] ${source}: JSON parse failed even after repair attempts`);
    return { error: `${source} returned malformed JSON.` };
  }

  try {
    const events: AiEvent[] = raw
      .filter((entry): entry is Record<string, unknown> =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).title === 'string' &&
        isValidCalendarDate(String((entry as Record<string, unknown>).date)),
      )
      .map(entry => ({
        title: String(entry.title).trim().slice(0, MAX_TITLE_LEN),
        date: String(entry.date),
        time: typeof entry.time === 'string' && /^\d{2}:\d{2}$/.test(entry.time) ? entry.time : null,
        notes: typeof entry.notes === 'string' ? entry.notes.trim().slice(0, MAX_NOTES_LEN) : '',
        sourceUrl: typeof entry.sourceUrl === 'string' ? sanitizeSourceUrl(entry.sourceUrl.trim()) : '',
      }));

    const homepageCount = events.filter(event => isLikelyHomepage(event.sourceUrl)).length;
    if (homepageCount > 0) {
      console.warn(`[ai-import] ${source}: ${homepageCount}/${events.length} events have homepage-like URLs - links may not be specific`);
    }
    debugLog?.(`[ai-import] ${source}: parsed ${events.length} valid events (${raw.length} raw)`);
    return { events };
  } catch (err) {
    console.error(`[ai-import] ${source}: event mapping error:`, err);
    return { error: `${source} returned malformed JSON.` };
  }
}

export function filterEventsByDateRange(
  result: AiImportResult,
  start?: string,
  end?: string,
  options: { debugLog?: DebugLogger } = {},
): AiImportResult {
  if (result.error || !result.events) return result;
  if (!start && !end) return result;

  const filtered = result.events.filter(event => {
    if (start && event.date < start) return false;
    if (end && event.date > end) return false;
    return true;
  });

  options.debugLog?.(`[ai-import] date range filter: ${result.events.length} -> ${filtered.length} events (${start || 'any'} to ${end || 'any'})`);
  return { events: filtered };
}
