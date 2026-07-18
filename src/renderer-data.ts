function getDayData(key: string): DayData | undefined {
  const value = calData[key];
  if (value && typeof value === 'object' && 'events' in value) return value as DayData;
  return undefined;
}

const calBridge = window.calAPI;

// The whole on-disk workspace (all calendars). `calData` always points at the active
// project's data, so every existing read/write keeps operating on the active tab.
let workspace: Workspace = { version: 3, activeProjectId: '', projects: [] };
let calData: CalData = { _recurring: [] };
let scheduleDate: string | null = null;
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

// ── Multi-project workspace ───────────────────────────────────────────────────
// Each tab is a fully independent project. Switching the active project repoints
// calData and notifies, so the React island re-renders against the new project
// without any of the domain logic below needing to know projects exist.
const calderaTabsListeners = new Set<() => void>();
function notifyCalendarTabsChanged(): void {
  calderaTabsListeners.forEach(listener => listener());
}

function generateProjectId(): string {
  return 'proj_' + generateCalendarEntryId();
}

function getActiveProject(): Project {
  return workspace.projects.find(project => project.id === workspace.activeProjectId) ?? workspace.projects[0];
}

function pointCalDataAtActiveProject(): void {
  calData = getActiveProject().data;
}

// Wrap whatever was on disk into a v3 workspace. v2 stored the list under
// `calendars`/`activeCalendarId`; a legacy single-calendar file (flat date keys +
// _recurring) becomes the workspace's first project. The top-level `_aiConfig` is
// intentionally left behind — it stays main-owned at the file root.
function migrateWorkspaceFormat(raw: Record<string, unknown>): Workspace {
  const version = raw ? (raw as { version?: unknown }).version : undefined;
  const isV3 = version === 3 && Array.isArray((raw as { projects?: unknown }).projects);
  const isV2 = version === 2 && Array.isArray((raw as { calendars?: unknown }).calendars);

  if (isV3 || isV2) {
    const source = raw as Record<string, unknown>;
    const rawList = (isV3 ? source.projects : source.calendars) as Array<Record<string, unknown>>;
    const rawActiveId = (isV3 ? source.activeProjectId : source.activeCalendarId) as string;
    const projects = (rawList || [])
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => ({
        id: typeof entry.id === 'string' && entry.id ? entry.id : generateProjectId(),
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Project',
        data: migrateCalendarDataFormat((entry.data as Record<string, unknown>) || {}),
      }));
    if (!projects.length) projects.push({ id: generateProjectId(), name: 'Project', data: { _recurring: [] } });
    const activeIsValid = projects.some(project => project.id === rawActiveId);
    return { version: 3, activeProjectId: activeIsValid ? rawActiveId : projects[0].id, projects };
  }

  const id = generateProjectId();
  return { version: 3, activeProjectId: id, projects: [{ id, name: 'Project', data: migrateCalendarDataFormat(raw) }] };
}

function loadWorkspaceFromRaw(raw: Record<string, unknown>): void {
  const wasCurrent = !!raw && (raw as { version?: unknown }).version === 3;
  workspace = migrateWorkspaceFormat(raw);
  pointCalDataAtActiveProject();
  if (!wasCurrent) void saveCalendarData(); // persist the upgrade (legacy/v1/v2 → v3) once
  notifyCalendarDataChanged();
  notifyCalendarTabsChanged();
}

window.calderaTabs = {
  list: () => workspace.projects.map(project => ({ id: project.id, name: project.name })),
  activeId: () => workspace.activeProjectId,
  setActive: (id) => {
    if (id === workspace.activeProjectId || !workspace.projects.some(project => project.id === id)) return;
    workspace.activeProjectId = id;
    pointCalDataAtActiveProject();
    undoStack.length = 0;
    redoStack.length = 0;
    notifyCalendarDataChanged();
    notifyCalendarTabsChanged();
    void saveCalendarData();
  },
  create: (name) => {
    const id = generateProjectId();
    const trimmed = (name || '').trim();
    workspace.projects.push({ id, name: trimmed || `Project ${workspace.projects.length + 1}`, data: { _recurring: [] } });
    workspace.activeProjectId = id;
    pointCalDataAtActiveProject();
    undoStack.length = 0;
    redoStack.length = 0;
    notifyCalendarDataChanged();
    notifyCalendarTabsChanged();
    void saveCalendarData();
    return id;
  },
  rename: (id, name) => {
    const project = workspace.projects.find(entry => entry.id === id);
    const trimmed = name.trim();
    if (!project || !trimmed) return;
    project.name = trimmed;
    notifyCalendarTabsChanged();
    void saveCalendarData();
  },
  close: (id) => {
    if (workspace.projects.length <= 1) return; // always keep at least one project
    const index = workspace.projects.findIndex(project => project.id === id);
    if (index === -1) return;
    workspace.projects.splice(index, 1);
    if (workspace.activeProjectId === id) {
      workspace.activeProjectId = workspace.projects[Math.max(0, index - 1)].id;
      pointCalDataAtActiveProject();
      undoStack.length = 0;
      redoStack.length = 0;
      notifyCalendarDataChanged();
    }
    notifyCalendarTabsChanged();
    void saveCalendarData();
  },
  reorder: (fromIndex, toIndex) => {
    const projects = workspace.projects;
    if (fromIndex < 0 || fromIndex >= projects.length || toIndex < 0 || toIndex >= projects.length || fromIndex === toIndex) return;
    const [moved] = projects.splice(fromIndex, 1);
    projects.splice(toIndex, 0, moved);
    notifyCalendarTabsChanged();
    void saveCalendarData();
  },
  subscribe(listener) {
    calderaTabsListeners.add(listener);
    return () => { calderaTabsListeners.delete(listener); };
  },
  notify: notifyCalendarTabsChanged,
};

async function saveCalendarData(): Promise<void> {
  normalizeCalendarBlockSubtasks(calData);
  syncCalendarBlockColorsToCurrentSkin();
  // calData is a reference to the active project's data, so persisting the whole
  // workspace already includes the edits just made. The main process preserves the
  // top-level _aiConfig it owns.
  await calBridge.saveData(workspace);
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
  void key;
  void options;
  await saveCalendarData();
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
  getActiveProject().data = calData; // undo/redo operates on the active project
  await saveCalendarData();
}

function migrateCalendarDataFormat(raw: Record<string, unknown>): CalData {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === '_recurring') {
      out._recurring = Array.isArray(value) ? value : [];
      continue;
    }

    // The per-project inbox is its own top-level array, not a day; without this branch
    // it would fall through to the legacy-day wrapper below and be destroyed on load.
    if (key === '_tasks') {
      out._tasks = Array.isArray(value) ? value : [];
      continue;
    }

    // The Money lens's budgets are likewise a top-level array, not a day.
    if (key === '_budgets') {
      out._budgets = Array.isArray(value) ? value : [];
      continue;
    }

    // _aiConfig lives at the workspace top level (main-owned); never fold it into a calendar.
    if (key === '_aiConfig') continue;

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
    if (block.recurrence === 'weekdays') return date.getDay() >= 1 && date.getDay() <= 5;
    if (block.recurrence === 'weekends') return date.getDay() === 0 || date.getDay() === 6;
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
