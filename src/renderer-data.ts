function getDayData(key: string): DayData | undefined {
  const value = calData[key];
  if (value && typeof value === 'object' && 'events' in value) return value as DayData;
  return undefined;
}

const calBridge = window.calAPI;

let calData: CalData = { _recurring: [] };
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let modalDate: string | null = null;
let pasteCellDate: string | null = null;
let renderedTodayKey: string | null = null;
let hoveredGridCell: Element | null = null;
let activeView: ViewType = 'calendar';
let scheduleDate: string | null = null;
let scheduleViewMode: ScheduleViewMode = 'daily';
let scheduleTimelineScale: ScheduleTimelineScale = 'day';
let clockDragState: { startMin: number; svg: SVGSVGElement } | null = null;
let timelineResizeState: TimelineResizeState | null = null;
let suppressNextTimelineBarClick = false;
let selectedScheduleBlock: ScheduleBlockSelection | null = null;
let aiPendingEvents: AiEvent[] = [];
let timeBlockPopupState: TimeBlockPopupState | null = null;
let clockAmPm: AmPm = new Date().getHours() >= 12 ? 'PM' : 'AM';
let rescheduleBlock: (TimeBlock & { _key: string }) | null = null;
let hoveredClockBlock: { block: TimeBlock | RecurringBlock; key: string } | null = null;
const undoStack: string[] = [];
const redoStack: string[] = [];
const MAX_HISTORY = 50;

function generateCalendarEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatDisplayDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function toElectronFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/');
}

function resolveCalendarImageUrl(relPath: string): Promise<string> {
  return calBridge.resolveImage(relPath).then(fullPath => toElectronFileUrl(fullPath));
}

function formatTime12h(t: string): string {
  if (!t) return '';
  const [hours, minutes] = t.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}

function getTodayKey(): string {
  const today = new Date();
  return dateKey(today.getFullYear(), today.getMonth(), today.getDate());
}

const calderaDataListeners = new Set<() => void>();

// Notify mirrors (currently the React island) that calData changed. Called after
// every persist and after the initial load so the store never reads stale data.
function notifyCalendarDataChanged(): void {
  calderaDataListeners.forEach(listener => listener());
}

// Expose the live calData and its persistence as a bridge so the React island can
// mirror one source of truth instead of loading a second, divergent copy.
window.calderaBridge = {
  getData: () => calData,
  save: () => saveCalendarData(),
  subscribe(listener) {
    calderaDataListeners.add(listener);
    return () => { calderaDataListeners.delete(listener); };
  },
  notify: notifyCalendarDataChanged,
  pushSnapshot: () => pushCalendarSnapshot(),
};

async function saveCalendarData(): Promise<void> {
  normalizeCalendarBlockSubtasks(calData);
  syncCalendarBlockColorsToCurrentSkin();
  await calBridge.saveData(calData);
  notifyCalendarDataChanged();
}

async function saveCalendarDataAndRefresh(
  key: string,
  options: {
    refreshCell?: boolean;
    refreshEventCards?: boolean;
    renderSchedule?: boolean;
    renderCurrentSchedule?: boolean;
    renderMonth?: boolean;
    renderCalendarGrid?: boolean;
  } = {},
): Promise<void> {
  await saveCalendarData();
  if (options.refreshCell) await refreshCalendarCell(key);
  if (options.refreshEventCards && modalDate === key) renderEventCards(key);
  if (options.renderCalendarGrid) renderCalendarGrid();
  if (options.renderMonth) renderMonthStrip();
  if (options.renderSchedule && activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
  if (options.renderCurrentSchedule && activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}

function pushCalendarSnapshot(): void {
  undoStack.push(JSON.stringify(calData));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

async function applyCalendarSnapshot(snapshot: string): Promise<void> {
  calData = JSON.parse(snapshot);
  normalizeCalendarBlockSubtasks(calData);
  normalizeCalendarBlockAppearance(calData);
  await saveCalendarData();
  renderCalendarGrid();
  renderMonthStrip();
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
  if (modalDate && !qId('modal-overlay').classList.contains('hidden')) renderEventCards(modalDate);
}

function migrateCalendarDataFormat(raw: Record<string, unknown>): CalData {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === '_recurring') {
      out._recurring = Array.isArray(value) ? value : [];
      continue;
    }

    if (key === '_aiConfig') {
      out._aiConfig = value;
      continue;
    }

    const valueObject = value as Record<string, unknown>;
    if (valueObject && typeof valueObject === 'object' && valueObject.events) {
      out[key] = value;
      const day = out[key] as DayData;
      if (!day.timeBlocks) day.timeBlocks = [];
      day.timeBlocks.forEach(block => {
        if (!block.ampm) block.ampm = 'AM';
        if (block.completed == null) block.completed = false;
      });
      continue;
    }

    const id = generateCalendarEntryId();
    const legacy = valueObject || {};
    out[key] = {
      events: [{
        id,
        image: (legacy.image as string | null) || null,
        notes: (legacy.notes as string) || '',
        time: (legacy.time as string) || '',
      }],
      featuredId: legacy.image ? id : null,
      timeBlocks: [],
    };
  }

  if (!out._recurring) out._recurring = [];
  const migrated = out as CalData;
  normalizeCalendarBlockSubtasks(migrated);
  normalizeCalendarBlockAppearance(migrated);
  return migrated;
}

function getOrInitDayData(key: string): DayData {
  if (!calData[key] || typeof calData[key] !== 'object' || !('events' in (calData[key] as object))) {
    calData[key] = { events: [], featuredId: null, timeBlocks: [] };
  }

  const day = calData[key] as DayData;
  if (!day.timeBlocks) day.timeBlocks = [];
  return day;
}

function getRecurringBlocksForDate(key: string): RecurringBlock[] {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return (calData._recurring || []).filter(block => {
    if (block.excludedDates?.includes(key)) return false;
    if (block.recurrence === 'daily') return true;
    if (block.recurrence === 'weekly') return date.getDay() === block.dayOfWeek;
    if (block.recurrence === 'monthly') return day === block.dayOfMonth;
    return false;
  });
}

function getFeaturedEvent(key: string): CalendarEvent | null {
  const day = getDayData(key);
  if (!day?.events?.length) return null;
  return day.events.find(event => event.id === day.featuredId) || day.events[0];
}

function pruneEmptyDayEntry(key: string): void {
  const day = getDayData(key);
  if (!day) return;
  if (!day.events.length) {
    delete calData[key];
    return;
  }
  if (!day.events.find(event => event.id === day.featuredId)) {
    day.featuredId = day.events[0].id;
  }
}

async function addEventFromPath(key: string, srcPath: string): Promise<void> {
  const id = generateCalendarEntryId();
  const fileName = `${key}-${id}`;
  const relPath = await calBridge.copyImage(srcPath, fileName);
  await addEventWithImage(key, id, relPath);
}

async function addEventWithImage(key: string, id: string, relPath: string): Promise<void> {
  const day = getOrInitDayData(key);
  day.events.push({ id, image: relPath, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await saveCalendarDataAndRefresh(key, { refreshCell: true, refreshEventCards: true });
}

async function addEmptyEvent(key: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getOrInitDayData(key);
  const id = generateCalendarEntryId();
  day.events.push({ id, image: null, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await saveCalendarDataAndRefresh(key, { refreshEventCards: true });
}

async function removeEvent(key: string, eventId: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getDayData(key);
  if (!day) return;

  const event = day.events.find(entry => entry.id === eventId);
  if (event?.image) await calBridge.deleteImage(event.image);

  day.events = day.events.filter(entry => entry.id !== eventId);
  if (day.featuredId === eventId) day.featuredId = day.events[0]?.id || null;

  pruneEmptyDayEntry(key);
  await saveCalendarDataAndRefresh(key, { refreshCell: true, refreshEventCards: true });
}

async function setFeaturedCalendarEvent(key: string, eventId: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getDayData(key);
  if (!day) return;
  day.featuredId = eventId;
  await saveCalendarDataAndRefresh(key, { refreshCell: true, refreshEventCards: true });
}

async function saveEventField(key: string, eventId: string, field: keyof CalendarEvent, value: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getDayData(key);
  if (!day) return;

  const event = day.events.find(entry => entry.id === eventId);
  if (!event) return;

  if (value) (event as unknown as Record<string, unknown>)[field] = value;
  else delete (event as unknown as Record<string, unknown>)[field];

  if (field === 'time' && day.featuredId === eventId) {
    await saveCalendarDataAndRefresh(key, { refreshCell: true });
    return;
  }

  await saveCalendarData();
}

async function assignEventImage(key: string, eventId: string, srcPath: string): Promise<void> {
  const day = getDayData(key);
  const event = day?.events.find(entry => entry.id === eventId);
  if (!event) return;

  if (event.image) await calBridge.deleteImage(event.image);
  const fileName = `${key}-${eventId}`;
  event.image = await calBridge.copyImage(srcPath, fileName);

  const hasFeaturedImage = day!.events.find(entry => entry.id === day!.featuredId)?.image;
  if (!hasFeaturedImage) day!.featuredId = eventId;

  await saveCalendarDataAndRefresh(key, { refreshCell: true, refreshEventCards: true });
}

async function removeEventImage(key: string, eventId: string): Promise<void> {
  const day = getDayData(key);
  const event = day?.events.find(entry => entry.id === eventId);
  if (!event?.image) return;

  await calBridge.deleteImage(event.image);
  event.image = null;

  if (day!.featuredId === eventId) {
    const otherFeatured = day!.events.find(entry => entry.id !== eventId && entry.image);
    day!.featuredId = otherFeatured?.id || day!.events.find(entry => entry.id !== eventId)?.id || null;
  }

  await saveCalendarDataAndRefresh(key, { refreshCell: true, refreshEventCards: true });
}
