/* ────────────────────────────────────────────────────────
   Caldera – renderer.ts
   Multi-event calendar: each day holds an array of events.
   Data shape per day:
     { events: [{ id, image, time, notes }], featuredId }
──────────────────────────────────────────────────────── */

// Types are provided globally by src/renderer-globals.d.ts — no import needed.
// Keeping this file import-free prevents TypeScript from emitting a CommonJS
// module wrapper (`Object.defineProperty(exports, ...)`) which would crash in
// a plain <script> tag context where `exports` is not defined.

// ── Local interfaces ────────────────────────────────────

interface Skin {
  id: SkinId;
  label: string;
  init: () => void;
  destroy: () => void;
}

interface TimeBlockPopupState {
  mode: 'new' | 'edit';
  key: string;
  startMin: number;
  endMin: number;
  id?: string;
  _cleanup?: () => void;
}

type BlockOrPartial =
  | (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean; recurrence?: string; dayOfWeek?: number; dayOfMonth?: number; completedDates?: string[]; excludedDates?: string[] })
  | { startMin: number; endMin: number; id?: undefined; label?: undefined; color?: string; ampm?: AmPm };

// ── DOM helpers ─────────────────────────────────────────

function qId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

// ── Typed SVG helper ─────────────────────────────────────

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ── CalData accessor helper ──────────────────────────────

function getDayData(key: string): DayData | undefined {
  const v = calData[key];
  if (v && typeof v === 'object' && 'events' in v) return v as DayData;
  return undefined;
}

const calBridge = window.calAPI;

// ── State ──────────────────────────────────────────────
let calData: CalData                                                    = { _recurring: [] };
let viewYear:          number                                           = new Date().getFullYear();
let viewMonth:         number                                           = new Date().getMonth();
let modalDate:         string | null                                    = null;
let pasteCellDate:     string | null                                    = null;
let renderedTodayKey:  string | null                                    = null;
let hoveredGridCell:   Element | null                                   = null;
let activeView:        ViewType                                         = 'calendar';
let scheduleDate:      string | null                                    = null;
let clockDragState:    { startMin: number; svg: SVGSVGElement } | null = null;
let aiPendingEvents:   AiEvent[]                                        = [];
let timeBlockPopupState: TimeBlockPopupState | null                     = null;
let clockAmPm:         AmPm                                             = new Date().getHours() >= 12 ? 'PM' : 'AM';
let rescheduleBlock:   (TimeBlock & { _key: string }) | null           = null;
let hoveredClockBlock: { block: TimeBlock | RecurringBlock; key: string } | null = null; // { block, key } – block the cursor is over on the clock face
const undoStack:       string[]                                         = [];
const redoStack:       string[]                                         = [];
const MAX_HISTORY      = 50;
const BLOCK_COLORS:    string[]                                         = ['#4f6ef7', '#e03030', '#2eb67d', '#f0a500', '#a259ff', '#ff6b35'];

// ── Skin registry ───────────────────────────────────────
const SKINS: Record<SkinId, Skin> = {
  default: { id: 'default', label: 'Default', init: () => {}, destroy: () => {} },
  glass:   { id: 'glass',   label: 'Glass',   init: initShaderBackground, destroy: destroyShaderBackground },
};

function getCurrentSkin(): SkinId {
  return (localStorage.getItem('skin') || 'default') as SkinId;
}

function activateSkin(id: SkinId): void {
  const prev = getCurrentSkin();
  if (SKINS[prev]) SKINS[prev].destroy();
  document.body.classList.forEach(cls => {
    if (cls.startsWith('skin-')) document.body.classList.remove(cls);
  });
  document.body.classList.add(`skin-${id}`);
  localStorage.setItem('skin', id);
  if (SKINS[id]) SKINS[id].init();
}

// ── WebGL shader background (glass skin) ───────────────
let _shaderRAF:           number | null                = null;
let _shaderGL:            WebGLRenderingContext | null = null;
let _shaderProg:          WebGLProgram | null          = null;
let _shaderTime:          number                       = 0;
let _shaderLast:          number | null                = null;
// Module-level variable replacing canvas._shaderResizeHandler (which is not valid on HTMLElement)
let _shaderResizeHandler: (() => void) | null          = null;

function initShaderBackground(): void {
  const canvas = qId('shader-bg') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl');
  if (!gl) { console.warn('Caldera: WebGL unavailable — glass skin will use CSS only.'); return; }
  _shaderGL = gl;
  // Narrow gl to non-null for all nested functions — the early-return above guarantees it.
  const glNN = gl;

  function compileShader(type: number, src: string): WebGLShader | null {
    const s = glNN.createShader(type);
    if (!s) return null;
    glNN.shaderSource(s, src);
    glNN.compileShader(s);
    if (!glNN.getShaderParameter(s, glNN.COMPILE_STATUS)) {
      console.error('Shader compile error:', glNN.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compileShader(glNN.VERTEX_SHADER, `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `);
  const fs = compileShader(glNN.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec2  u_resolution;
    uniform float u_time;

    vec3 palette(float t) {
      vec3 a = vec3(0.04, 0.03, 0.10);
      vec3 b = vec3(0.07, 0.04, 0.12);
      vec3 c = vec3(0.80, 0.00, 0.90);
      vec3 d = vec3(0.20, 0.50, 0.65);
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      uv.x *= u_resolution.x / u_resolution.y;
      float t = u_time * 0.15;
      float d = 0.0;
      vec2  p = uv * 2.5;
      for (int i = 0; i < 4; i++) {
        p = vec2(
          sin(p.y * 1.8 + t + float(i) * 0.7) + cos(p.x * 1.3 - t * 0.6),
          cos(p.x * 1.6 - t * 0.8 + float(i) * 0.5) + sin(p.y * 1.4 + t * 0.4)
        );
        d += length(p) * 0.25;
      }
      vec3 col = palette(d * 0.5 + t * 0.1);
      col = pow(col, vec3(1.15));
      gl_FragColor = vec4(col, 1.0);
    }
  `);
  if (!vs || !fs) return;

  const prog = glNN.createProgram();
  if (!prog) return;
  glNN.attachShader(prog, vs);
  glNN.attachShader(prog, fs);
  glNN.linkProgram(prog);
  if (!glNN.getProgramParameter(prog, glNN.LINK_STATUS)) {
    console.error('Shader link error:', glNN.getProgramInfoLog(prog));
    return;
  }
  _shaderProg = prog;

  const buf = glNN.createBuffer();
  glNN.bindBuffer(glNN.ARRAY_BUFFER, buf);
  glNN.bufferData(glNN.ARRAY_BUFFER, new Float32Array([
    -1,-1, 1,-1, -1, 1,
    -1, 1, 1,-1,  1, 1,
  ]), glNN.STATIC_DRAW);
  const posLoc = glNN.getAttribLocation(prog, 'a_position');
  glNN.enableVertexAttribArray(posLoc);
  glNN.vertexAttribPointer(posLoc, 2, glNN.FLOAT, false, 0, 0);

  const uRes  = glNN.getUniformLocation(prog, 'u_resolution');
  const uTime = glNN.getUniformLocation(prog, 'u_time');

  function resizeCanvas(): void {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    glNN.viewport(0, 0, canvas.width, canvas.height);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  _shaderResizeHandler = resizeCanvas;

  _shaderTime = 0;
  _shaderLast = null;

  function frame(ts: number): void {
    if (_shaderLast !== null) _shaderTime += (ts - _shaderLast) * 0.001;
    _shaderLast = ts;
    glNN.useProgram(_shaderProg);
    glNN.uniform2f(uRes, canvas.width, canvas.height);
    glNN.uniform1f(uTime, _shaderTime);
    glNN.drawArrays(glNN.TRIANGLES, 0, 6);
    _shaderRAF = requestAnimationFrame(frame);
  }
  _shaderRAF = requestAnimationFrame(frame);
}

function destroyShaderBackground(): void {
  if (_shaderRAF !== null) { cancelAnimationFrame(_shaderRAF); _shaderRAF = null; }
  if (_shaderResizeHandler) {
    window.removeEventListener('resize', _shaderResizeHandler);
    _shaderResizeHandler = null;
  }
  if (_shaderGL && _shaderProg) _shaderGL.deleteProgram(_shaderProg);
  _shaderGL = null;
  _shaderProg = null;
  _shaderLast = null;
}

// ── Boot ───────────────────────────────────────────────
async function initCalendarApp(): Promise<void> {
  applyCalendarTheme(localStorage.getItem('theme') === 'dark');
  activateSkin(getCurrentSkin());
  const raw = await calBridge.loadData();
  calData = migrateCalendarDataFormat(raw);
  renderMonthStrip();
  renderCalendarGrid();
  bindCalendarUIEvents();
}

function applyCalendarTheme(isDarkMode: boolean): void {
  document.body.classList.toggle('dark', isDarkMode);
  qId('btn-theme').textContent = isDarkMode ? '\u2600' : '\u263E';
}

// ── Helpers ────────────────────────────────────────────
function generateCalendarEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatDisplayDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function toElectronFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/');
}

// Resolves a stored relative image path (e.g. "images/2025-01-01-abc.png") to a
// safe file:// URL via the main process. Centralises the resolveImage + toElectronFileUrl
// two-step that was previously duplicated at every call site.
async function resolveCalendarImageUrl(relPath: string): Promise<string> {
  const fullPath = await calBridge.resolveImage(relPath);
  return toElectronFileUrl(fullPath);
}

function formatTime12h(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Returns today's date key — computed fresh each call so the app
// stays correct if left open past midnight.
function getTodayKey(): string {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

async function saveCalendarData(): Promise<void> {
  await calBridge.saveData(calData);
}

function pushCalendarSnapshot(): void {
  undoStack.push(JSON.stringify(calData));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // any new user action invalidates the redo chain
}

async function applyCalendarSnapshot(snapshot: string): Promise<void> {
  calData = JSON.parse(snapshot);
  await saveCalendarData();
  renderCalendarGrid();
  renderMonthStrip();
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
  if (modalDate && !qId('modal-overlay').classList.contains('hidden'))
    renderEventCards(modalDate);
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const CELL_HOVER_SCROLL_PX_PER_SEC = 20;

function measureImageNaturalDimensions(url: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });
}

// ── Migration: old single-event format → new multi-event ──
function migrateCalendarDataFormat(raw: Record<string, unknown>): CalData {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key === '_recurring') {
      out._recurring = Array.isArray(val) ? val : [];
      continue;
    }
    if (key === '_aiConfig') {
      out._aiConfig = val;
      continue;
    }
    const valObj = val as Record<string, unknown>;
    if (valObj && typeof valObj === 'object' && valObj.events) {
      out[key] = val;
      const day = out[key] as DayData;
      if (!day.timeBlocks) day.timeBlocks = [];
      day.timeBlocks.forEach(b => {
        if (!b.ampm)             b.ampm      = 'AM';
        if (b.completed == null) b.completed = false;
      });
    } else {
      const id = generateCalendarEntryId();
      const legacy = valObj || {};
      out[key] = {
        events:     [{ id, image: (legacy.image as string | null) || null, notes: (legacy.notes as string) || '', time: (legacy.time as string) || '' }],
        featuredId: legacy.image ? id : null,
      };
    }
  }
  if (!out._recurring) out._recurring = [];
  return out as CalData;
}

// ── Day data helpers ────────────────────────────────────
function getOrInitDayData(key: string): DayData {
  if (!calData[key] || typeof calData[key] !== 'object' || !('events' in (calData[key] as object))) {
    calData[key] = { events: [], featuredId: null, timeBlocks: [] };
  }
  const day = calData[key] as DayData;
  if (!day.timeBlocks) day.timeBlocks = [];
  return day;
}

function getRecurringBlocksForDate(key: string): RecurringBlock[] {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return (calData._recurring || []).filter(b => {
    if (b.excludedDates?.includes(key)) return false;
    if (b.recurrence === 'daily')   return true;
    if (b.recurrence === 'weekly')  return date.getDay() === b.dayOfWeek;
    if (b.recurrence === 'monthly') return d === b.dayOfMonth;
    return false;
  });
}

function getFeaturedEvent(key: string): CalendarEvent | null {
  const day = getDayData(key);
  if (!day?.events?.length) return null;
  return day.events.find(e => e.id === day.featuredId) || day.events[0];
}

function pruneEmptyDayEntry(key: string): void {
  const day = getDayData(key);
  if (!day) return;
  if (!day.events.length) { delete calData[key]; return; }
  if (!day.events.find(e => e.id === day.featuredId)) {
    day.featuredId = day.events[0].id;
  }
}

// ── Strip ──────────────────────────────────────────────
function renderMonthStrip(): void {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  qId('current-label').textContent = `${months[viewMonth]} ${viewYear}`;
  (document.querySelectorAll('.month-tab') as NodeListOf<HTMLElement>).forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.month!) === viewMonth)
  );
}

// ── Grid ───────────────────────────────────────────────
// Cells are built synchronously first, then all resolveImage calls
// fire in parallel via Promise.all so the grid never waits 31× in series.
async function renderCalendarGrid(): Promise<void> {
  hoveredGridCell = null;

  const grid = qId('calendar-grid');
  grid.innerHTML = '';

  // Restart the glass-skin entrance animation on every grid render (month navigation, today
  // re-render, etc.).  The class is removed by a persistent animationend listener set up in
  // bindCalendarUIEvents so the opacity/transform fill-mode never lingers on the compositor —
  // a persisted animation state can be reset by Chromium when backdrop-filter overlays are
  // shown or hidden, leaving the grid invisible after the overlay closes.
  if (document.body.classList.contains('skin-glass')) {
    grid.classList.remove('is-entering');
    void grid.offsetHeight; // force reflow so re-adding the class triggers a fresh animation
    grid.classList.add('is-entering');
  }

  const todayKey    = getTodayKey();
  renderedTodayKey  = todayKey;
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'day-cell empty';
    grid.appendChild(blank);
  }

  const imageResolves: Promise<void>[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const key  = dateKey(viewYear, viewMonth, d);
    const cell = document.createElement('div');
    cell.className    = 'day-cell';
    cell.dataset.date = key;
    if (key === todayKey) cell.classList.add('today');
    if (key < todayKey)   cell.classList.add('past');

    const dayNum = document.createElement('span');
    dayNum.className = 'day-num';
    dayNum.textContent = String(d);
    cell.appendChild(dayNum);

    const featured = getFeaturedEvent(key);
    if (featured?.image) {
      cell.classList.add('has-image');
      const bg = document.createElement('div');
      bg.className = 'cell-bg';
      cell.insertBefore(bg, dayNum);
      // Collect resolve promise — all will run concurrently below
      imageResolves.push(
        resolveCalendarImageUrl(featured.image).then(url => {
          bg.style.backgroundImage = `url("${url}")`;
        }).catch(err => console.error(`Failed to resolve featured image for ${key}:`, err))
      );
    }

    const count = getDayData(key)?.events?.length || 0;
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className   = 'cell-count';
      badge.textContent = String(count);
      cell.appendChild(badge);
    }

    if (featured?.time) {
      const tb = document.createElement('span');
      tb.className   = 'cell-time';
      tb.textContent = formatTime12h(featured.time);
      cell.appendChild(tb);
    }

    cell.addEventListener('dragenter', onCellDragEnter);
    cell.addEventListener('dragover',  onCellDragOver);
    cell.addEventListener('dragleave', onCellDragLeave);
    cell.addEventListener('drop',      onCalendarCellDrop);
    cell.addEventListener('click', () => {
      scheduleDate = key;
      if (activeView === 'schedule') renderScheduleView(key);
      openDayDetailModal(key);
    });
    cell.addEventListener('mouseenter', () => {
      pasteCellDate = key;
      if (getDayData(key)?.events?.some(e => e.image)) {
        setupHoverScrollStrip(cell, key).catch(console.error);
      }
    });
    cell.addEventListener('mouseleave', () => {
      pasteCellDate = null;
      teardownHoverScrollStrip(cell);
    });

    grid.appendChild(cell);
  }

  // Resolve all image paths concurrently
  await Promise.all(imageResolves);
}

async function refreshCalendarCell(key: string): Promise<void> {
  const cell = document.querySelector(`.day-cell[data-date="${key}"]`) as HTMLElement | null;
  if (!cell) return;

  // If this cell has an active hover strip, cancel it
  if (hoveredGridCell === cell) hoveredGridCell = null;

  cell.querySelector('.cell-bg')?.remove();
  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.querySelector('.cell-time')?.remove();
  cell.querySelector('.cell-count')?.remove();

  const featured = getFeaturedEvent(key);
  if (featured?.image) {
    cell.classList.add('has-image');
    const bg = document.createElement('div');
    bg.className = 'cell-bg';
    bg.style.backgroundImage = `url("${await resolveCalendarImageUrl(featured.image)}")`;
    cell.insertBefore(bg, cell.querySelector('.day-num'));
  } else {
    cell.classList.remove('has-image');
  }

  const count = getDayData(key)?.events?.length || 0;
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className   = 'cell-count';
    badge.textContent = String(count);
    cell.appendChild(badge);
  }

  if (featured?.time) {
    const tb = document.createElement('span');
    tb.className   = 'cell-time';
    tb.textContent = formatTime12h(featured.time);
    cell.appendChild(tb);
  }
}

// ── Hover scroll strip ──────────────────────────────────
// On mouseenter: builds a vertically-scrolling strip over the hovered cell.
// Each segment height = max(cellHeight, cellWidth × imgH/imgW) so portrait
// images scroll through more content at the same px/s rate.
// Cell size is stable during hover, so we measure once — no ResizeObserver needed.
async function setupHoverScrollStrip(cell: HTMLElement, key: string): Promise<void> {
  hoveredGridCell = cell;

  const day = getDayData(key);
  if (!day?.events?.length) return;

  // All events with images, featured image first
  const withImages = day.events.filter(e => e.image);
  if (!withImages.length) return;
  withImages.sort((a, b) => {
    if (a.id === day.featuredId) return -1;
    if (b.id === day.featuredId) return 1;
    return 0;
  });

  const strip = document.createElement('div');
  strip.className = 'cell-scroll-strip';

  // Resolve all image paths and measure natural dimensions concurrently
  const imageInfo = await Promise.all(
    withImages.map(async ev => {
      const url  = await resolveCalendarImageUrl(ev.image!);
      const size = await measureImageNaturalDimensions(url);
      return { url, size };
    })
  );

  // Bail if the mouse left this cell while images were loading
  if (hoveredGridCell !== cell) return;

  // Each image gets its own segment so the strip can scroll through multiple photos independently
  const segments = imageInfo.map(({ url }) => {
    const seg = document.createElement('div');
    seg.className = 'cell-scroll-segment';
    seg.style.backgroundImage = `url("${url}")`;
    strip.appendChild(seg);
    return seg;
  });

  // Clone of first segment for seamless continuous loop
  const clone = document.createElement('div');
  clone.className = 'cell-scroll-segment';
  clone.style.backgroundImage = `url("${imageInfo[0].url}")`;
  strip.appendChild(clone);

  // Remove any stale strip before inserting (handles rapid re-hover on same cell)
  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.insertBefore(strip, cell.querySelector('.day-num'));

  // Measure cell once — size is stable for the duration of the hover
  const cellH = cell.offsetHeight;
  const cellW = cell.offsetWidth;

  // Segment height = natural image height scaled to cell width,
  // minimum cellH so landscape images still fill the cell.
  const segHeights = imageInfo.map(({ size }) =>
    Math.max(cellH, size.w > 0 ? Math.round(cellW * size.h / size.w) : cellH)
  );

  segments.forEach((seg, i) => { seg.style.height = segHeights[i] + 'px'; });
  clone.style.height = segHeights[0] + 'px';

  const totalTravel = segHeights.reduce((a, b) => a + b, 0);
  const duration    = (totalTravel / CELL_HOVER_SCROLL_PX_PER_SEC).toFixed(2);
  strip.style.setProperty('--scroll-dist', `-${totalTravel}px`);
  strip.style.animation = `cell-strip-scroll ${duration}s linear infinite`;
}

function teardownHoverScrollStrip(cell: HTMLElement): void {
  hoveredGridCell = null;
  cell.querySelector('.cell-scroll-strip')?.remove();
}

// ── Drag & Drop (cells) ────────────────────────────────
const dragCounters = new WeakMap<Element, number>();

function onCellDragEnter(e: DragEvent): void {
  e.preventDefault();
  const cell = e.currentTarget as HTMLElement;
  dragCounters.set(cell, (dragCounters.get(cell) || 0) + 1);
  cell.classList.add('drag-over');
}
function onCellDragOver(e: DragEvent): void { e.preventDefault(); }
function onCellDragLeave(e: DragEvent): void {
  const cell  = e.currentTarget as HTMLElement;
  const count = (dragCounters.get(cell) || 1) - 1;
  dragCounters.set(cell, count);
  if (count <= 0) { dragCounters.set(cell, 0); cell.classList.remove('drag-over'); }
}
async function onCalendarCellDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  const cell = e.currentTarget as HTMLElement;
  dragCounters.set(cell, 0);
  cell.classList.remove('drag-over');

  const file = e.dataTransfer!.files[0];
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return;

  await addEventFromPath(cell.dataset.date!, calBridge.getPathForFile(file));
}

// ── Paste ──────────────────────────────────────────────
document.addEventListener('paste', async (e: ClipboardEvent): Promise<void> => {
  const targetKey = modalDate || pasteCellDate;
  if (!targetKey) return;

  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    // Explicit allowlist — image/gif, image/svg+xml etc. are excluded because
    // ALLOWED_IMAGE_EXTS in main.js only accepts png/jpg/jpeg/webp.
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(item.type)) continue;
    const blob = item.getAsFile();
    if (!blob) continue;

    const ext      = item.type === 'image/png' ? '.png' : item.type === 'image/webp' ? '.webp' : '.jpg';
    const id       = generateCalendarEntryId();
    const fileName = `${targetKey}-${id}`;
    const buf      = await blob.arrayBuffer();
    const relPath  = await calBridge.saveImageBuffer(Array.from(new Uint8Array(buf)), fileName, ext);
    await addEventWithImage(targetKey, id, relPath);
    break;
  }
});

// ── Event management ───────────────────────────────────
async function addEventFromPath(key: string, srcPath: string): Promise<void> {
  const id       = generateCalendarEntryId();
  const fileName = `${key}-${id}`;
  const relPath  = await calBridge.copyImage(srcPath, fileName);
  await addEventWithImage(key, id, relPath);
}

async function addEventWithImage(key: string, id: string, relPath: string): Promise<void> {
  const day = getOrInitDayData(key);
  day.events.push({ id, image: relPath, notes: '', time: '' });
  // Auto-feature the very first event on a day
  if (!day.featuredId) day.featuredId = id;
  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function addEmptyEvent(key: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getOrInitDayData(key);
  const id  = generateCalendarEntryId();
  day.events.push({ id, image: null, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await saveCalendarData();
  if (modalDate === key) renderEventCards(key);
}

async function removeEvent(key: string, eventId: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getDayData(key);
  if (!day) return;

  const ev = day.events.find(e => e.id === eventId);
  if (ev?.image) await calBridge.deleteImage(ev.image);

  day.events = day.events.filter(e => e.id !== eventId);
  if (day.featuredId === eventId) day.featuredId = day.events[0]?.id || null;

  pruneEmptyDayEntry(key);
  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function setFeaturedCalendarEvent(key: string, eventId: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getDayData(key);
  if (!day) return;
  day.featuredId = eventId;
  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function saveEventField(key: string, eventId: string, field: keyof CalendarEvent, value: string): Promise<void> {
  pushCalendarSnapshot();
  const day = getDayData(key);
  if (!day) return;
  const ev = day.events.find(e => e.id === eventId);
  if (!ev) return;
  if (value) (ev as unknown as Record<string, unknown>)[field] = value;
  else delete (ev as unknown as Record<string, unknown>)[field];
  if (field === 'time' && day.featuredId === eventId) await refreshCalendarCell(key);
  await saveCalendarData();
}

async function assignEventImage(key: string, eventId: string, srcPath: string): Promise<void> {
  const day = getDayData(key);
  const ev  = day?.events.find(e => e.id === eventId);
  if (!ev) return;

  if (ev.image) await calBridge.deleteImage(ev.image);
  const fileName = `${key}-${eventId}`;
  ev.image = await calBridge.copyImage(srcPath, fileName);

  // If the day has no featured image yet, promote this event
  const hasFeaturedImg = day!.events.find(e => e.id === day!.featuredId)?.image;
  if (!hasFeaturedImg) day!.featuredId = eventId;

  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function removeEventImage(key: string, eventId: string): Promise<void> {
  const day = getDayData(key);
  const ev  = day?.events.find(e => e.id === eventId);
  if (!ev?.image) return;

  await calBridge.deleteImage(ev.image);
  ev.image = null;

  // If this was the featured event, find another with an image
  if (day!.featuredId === eventId) {
    const other = day!.events.find(e => e.id !== eventId && e.image);
    day!.featuredId = other?.id || day!.events.find(e => e.id !== eventId)?.id || null;
  }

  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

// ── Lightbox ───────────────────────────────────────────
function openLightbox(url: string): void {
  qId<HTMLImageElement>('lightbox-img').src = url;
  qId('lightbox-overlay').classList.remove('hidden');
}

function closeLightbox(): void {
  qId('lightbox-overlay').classList.add('hidden');
  qId<HTMLImageElement>('lightbox-img').src = '';
}

// ── Modal ──────────────────────────────────────────────
function openDayDetailModal(key: string): void {
  modalDate = key;
  qId('modal-date').textContent = formatDisplayDate(key);
  renderEventCards(key);
  qId('modal-overlay').classList.remove('hidden');
  if (document.body.classList.contains('skin-glass')) {
    const modal = qId('modal');
    modal.style.animation = 'none';
    void modal.offsetWidth;
    modal.style.animation = '';
  }
}

function closeDayDetailModal(): void {
  modalDate = null;
  qId('modal-overlay').classList.add('hidden');
}

function renderEventCards(key: string): void {
  const container = qId('event-cards');
  container.innerHTML = '';

  const day    = getDayData(key);
  const events = day?.events || [];

  events.forEach(ev => {
    container.appendChild(buildEventCard(key, ev, ev.id === day?.featuredId));
  });

  // Drop zone — always at the bottom of the list
  const zone = document.createElement('div');
  zone.className   = 'modal-add-zone';
  zone.textContent = events.length === 0
    ? 'Drop an image here or click \u201C+ Add Event\u201D to get started'
    : '+ Drop an image here to add another event';

  let zoneCounter = 0;
  zone.addEventListener('dragenter', (e: DragEvent) => {
    e.preventDefault();
    zoneCounter++;
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
  zone.addEventListener('dragleave', () => {
    if (--zoneCounter <= 0) { zoneCounter = 0; zone.classList.remove('drag-over'); }
  });
  zone.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    zoneCounter = 0;
    zone.classList.remove('drag-over');
    if (!modalDate) return;
    const file = e.dataTransfer!.files[0];
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) return;
    await addEventFromPath(modalDate, calBridge.getPathForFile(file));
  });

  container.appendChild(zone);
}

function buildEventCard(key: string, ev: CalendarEvent, isFeatured: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className   = 'event-card' + (isFeatured ? ' featured' : '');
  card.dataset.id  = ev.id;

  // ── Toolbar ──────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'card-toolbar';

  const btnCover = document.createElement('button');
  btnCover.className = 'btn-cover';
  btnCover.title     = isFeatured ? 'Calendar cover' : 'Set as calendar cover';
  btnCover.textContent = isFeatured ? '\u2605' : '\u2606'; // ★ / ☆
  if (!isFeatured) btnCover.addEventListener('click', () => setFeaturedCalendarEvent(key, ev.id));

  const coverLabel = document.createElement('span');
  coverLabel.className   = 'cover-label';
  coverLabel.textContent = 'Cover';
  if (!isFeatured) coverLabel.style.display = 'none';

  const spacer = document.createElement('span');
  spacer.className = 'card-spacer';

  const btnAssign = document.createElement('button');
  btnAssign.className   = 'card-action-btn';
  btnAssign.textContent = '\uD83D\uDCF7 Assign';
  btnAssign.title       = 'Assign image via file dialog';
  btnAssign.addEventListener('click', async () => {
    const srcPath = await calBridge.openFileDialog();
    if (srcPath) await assignEventImage(key, ev.id, srcPath);
  });

  const btnRemoveImg = document.createElement('button');
  btnRemoveImg.className   = 'card-action-btn';
  btnRemoveImg.textContent = '\uD83D\uDDD1 Remove';
  btnRemoveImg.title       = 'Remove image';
  btnRemoveImg.style.display = ev.image ? '' : 'none';
  btnRemoveImg.addEventListener('click', () => removeEventImage(key, ev.id));

  const btnDel = document.createElement('button');
  btnDel.className   = 'card-action-btn btn-del-card';
  btnDel.textContent = '\u2715';
  btnDel.title       = 'Delete this event';
  btnDel.addEventListener('click', () => removeEvent(key, ev.id));

  toolbar.append(btnCover, coverLabel, spacer, btnAssign, btnRemoveImg, btnDel);

  // ── Image area ───────────────────────────────────────
  const imgArea = document.createElement('div');
  imgArea.className = 'card-image-area';

  const img = document.createElement('img');
  img.className = 'card-img' + (ev.image ? '' : ' hidden');
  img.alt = '';

  const noImg = document.createElement('div');
  noImg.className   = 'card-no-img';
  noImg.textContent = 'Drop image here or use Assign';
  if (ev.image) noImg.style.display = 'none';

  imgArea.append(img, noImg);

  if (ev.image) {
    imgArea.classList.add('has-image');
    resolveCalendarImageUrl(ev.image)
      .then(url => { img.src = url; })
      .catch(err => console.error(`Failed to resolve event image for event ${ev.id}:`, err));
    imgArea.addEventListener('click', () => { if (img.src) openLightbox(img.src); });
  }

  // Drag-drop on card image area → replaces this event's image
  let imgCounter = 0;
  imgArea.addEventListener('dragenter', (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    imgCounter++;
    imgArea.classList.add('drag-over');
  });
  imgArea.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); });
  imgArea.addEventListener('dragleave', () => {
    if (--imgCounter <= 0) { imgCounter = 0; imgArea.classList.remove('drag-over'); }
  });
  imgArea.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    imgCounter = 0;
    imgArea.classList.remove('drag-over');
    const file = e.dataTransfer!.files[0];
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) return;
    await assignEventImage(key, ev.id, calBridge.getPathForFile(file));
  });

  // ── Fields ───────────────────────────────────────────
  const fields = document.createElement('div');
  fields.className = 'card-fields';

  const timeRow   = document.createElement('div');
  timeRow.className = 'card-time-row';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time';
  const timeInput = document.createElement('input') as HTMLInputElement;
  timeInput.type      = 'time';
  timeInput.className = 'card-time';
  timeInput.value     = ev.time || '';
  timeInput.addEventListener('change', () => saveEventField(key, ev.id, 'time', timeInput.value));
  timeRow.append(timeLabel, timeInput);

  const notes = document.createElement('textarea');
  notes.className   = 'card-notes';
  notes.placeholder = 'Notes\u2026';
  notes.value       = ev.notes || '';
  const saveNotes = debounce(() => saveEventField(key, ev.id, 'notes', notes.value.trim()), 400);
  notes.addEventListener('input', saveNotes);

  fields.append(timeRow, notes);
  card.append(toolbar, imgArea, fields);
  return card;
}

// ── UI bindings ────────────────────────────────────────
function bindCalendarUIEvents(): void {
  // Remove the glass-skin .is-entering class once the entrance animation completes so the
  // animated opacity/transform don't persist on the compositor — see renderCalendarGrid
  // for a full explanation of why this matters.
  qId('calendar-grid').addEventListener('animationend', (e: AnimationEvent) => {
    if (e.animationName === 'glass-cell-enter') (e.currentTarget as HTMLElement).classList.remove('is-entering');
  });

  qId('btn-min').addEventListener('click', () => calBridge.winMinimize());
  qId('btn-max').addEventListener('click', () => calBridge.winMaximize());
  qId('btn-close').addEventListener('click', () => calBridge.winClose());

  qId('btn-theme').addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    qId('btn-theme').textContent = isDark ? '\u2600' : '\u263E';
  });

  qId('btn-skin').addEventListener('click', openSkinPicker);

  qId('btn-ai').addEventListener('click', openAiSettingsModal);
  qId('ai-modal-close').addEventListener('click', closeAiSettingsModal);
  qId('ai-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('ai-overlay')) closeAiSettingsModal();
  });
  qId<HTMLInputElement>('ai-provider-claude').addEventListener('change', () => syncAiProviderPanel('claude'));
  qId<HTMLInputElement>('ai-provider-ollama').addEventListener('change', () => syncAiProviderPanel('ollama'));
  qId<HTMLInputElement>('ai-mode-fetch').addEventListener('change', () => syncAiModePanel('fetch'));
  qId<HTMLInputElement>('ai-mode-websearch').addEventListener('change', () => syncAiModePanel('websearch'));
  qId('ai-url-add-btn').addEventListener('click', () => {
    const input = qId<HTMLInputElement>('ai-url-input');
    const url   = input.value.trim();
    if (!url) return;
    const current = getAiSitesFromList();
    if (!current.includes(url)) renderAiUrlList([...current, url]);
    input.value = '';
  });
  qId('ai-url-input').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') qId('ai-url-add-btn').click();
  });
  qId('ai-save-btn').addEventListener('click', saveAiSettings);
  qId('ai-run-btn').addEventListener('click', runAiImport);

  qId('ai-review-close').addEventListener('click', closeAiReviewModal);
  qId('ai-review-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('ai-review-overlay')) closeAiReviewModal();
  });
  qId('ai-select-all-btn').addEventListener('click', () => {
    (document.querySelectorAll('#ai-event-list .ai-event-row') as NodeListOf<HTMLElement>).forEach(row => {
      row.classList.add('checked');
      (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = true;
    });
  });
  qId('ai-deselect-all-btn').addEventListener('click', () => {
    (document.querySelectorAll('#ai-event-list .ai-event-row') as NodeListOf<HTMLElement>).forEach(row => {
      row.classList.remove('checked');
      (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = false;
    });
  });
  qId('ai-add-selected-btn').addEventListener('click', addSelectedAiEvents);

  qId('skin-modal-close').addEventListener('click', closeSkinPicker);
  qId('skin-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('skin-overlay')) closeSkinPicker();
  });

  qId('prev-month').addEventListener('click', () => changeMonth(-1));
  qId('next-month').addEventListener('click', () => changeMonth(1));
  qId('prev-year').addEventListener('click',  () => changeYear(-1));
  qId('next-year').addEventListener('click',  () => changeYear(1));

  (document.querySelectorAll('.month-tab') as NodeListOf<HTMLElement>).forEach(btn => {
    btn.addEventListener('click', () => {
      viewMonth = parseInt(btn.dataset.month!);
      renderMonthStrip();
      renderCalendarGrid();
      if (activeView !== 'calendar') switchCalendarView('calendar');
    });
  });

  (document.querySelectorAll('.view-tab') as NodeListOf<HTMLElement>).forEach(btn => {
    btn.addEventListener('click', () => {
      // #btn-ai shares the .view-tab class for styling but has no data-view —
      // skip it here so clicking AI doesn't call switchCalendarView(undefined),
      // which would hide #calendar-wrapper via its view !== 'calendar' toggle.
      if (!btn.dataset.view) return;
      if (btn.dataset.view === 'schedule') {
        scheduleDate = getTodayKey();
        clockAmPm = new Date().getHours() < 12 ? 'AM' : 'PM';
      }
      switchCalendarView(btn.dataset.view as ViewType);
    });
  });
  qId('sched-prev-day').addEventListener('click', () => stepScheduleDay(-1));
  qId('sched-next-day').addEventListener('click', () => stepScheduleDay(1));

  (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>).forEach(btn => {
    btn.addEventListener('click', () => {
      clockAmPm = btn.dataset.ampm as AmPm;
      (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>).forEach(b =>
        b.classList.toggle('active', b.dataset.ampm === clockAmPm)
      );
      if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    });
  });
  qId('reschedule-confirm').addEventListener('click', confirmReschedule);
  qId('reschedule-cancel').addEventListener('click', cancelReschedule);

  qId('modal-close').addEventListener('click', closeDayDetailModal);
  qId('modal-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('modal-overlay')) closeDayDetailModal();
  });

  qId('lightbox-close').addEventListener('click', closeLightbox);
  qId('lightbox-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('lightbox-overlay')) closeLightbox();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!qId('ai-review-overlay').classList.contains('hidden')) { closeAiReviewModal(); return; }
      if (!qId('ai-overlay').classList.contains('hidden'))        { closeAiSettingsModal(); return; }
      if (!qId('skin-overlay').classList.contains('hidden')) { closeSkinPicker(); return; }
      if (!qId('lightbox-overlay').classList.contains('hidden')) closeLightbox();
      else if (modalDate) closeDayDetailModal();
      else if (rescheduleBlock) cancelReschedule();
      return;
    }

    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName);

    // Backspace over a hovered clock block → delete it
    if (e.key === 'Backspace' && hoveredClockBlock && !inInput) {
      e.preventDefault();
      const { block, key } = hoveredClockBlock;
      hoveredClockBlock = null;
      deleteTimeBlock(key, block.id, (block as BlockOrPartial & { _recurring?: boolean })._recurring ? 'all' : undefined);
      return;
    }

    // Ctrl+Z — matches the undo convention users expect from native desktop apps
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey && !inInput) {
      e.preventDefault();
      if (undoStack.length) {
        redoStack.push(JSON.stringify(calData));
        applyCalendarSnapshot(undoStack.pop()!);
      }
      return;
    }

    // Ctrl+Shift+Z — matches the redo convention; Ctrl+Y intentionally not supported to keep it simple
    if (e.ctrlKey && e.shiftKey && e.key === 'Z' && !inInput) {
      e.preventDefault();
      if (redoStack.length) {
        undoStack.push(JSON.stringify(calData));
        applyCalendarSnapshot(redoStack.pop()!);
      }
      return;
    }
  });

  qId('btn-add-event').addEventListener('click', () => {
    if (modalDate) addEmptyEvent(modalDate);
  });

  qId('btn-schedule-day').addEventListener('click', () => {
    const targetDate = modalDate;
    closeDayDetailModal();
    scheduleDate = targetDate;
    clockAmPm = new Date().getHours() < 12 ? 'AM' : 'PM';
    switchCalendarView('schedule');
  });

  bindGlassButtonLightFollow();
}

// ── Skin picker ─────────────────────────────────────────
function openSkinPicker(): void {
  renderSkinGrid();
  qId('skin-overlay').classList.remove('hidden');
}

function closeSkinPicker(): void {
  qId('skin-overlay').classList.add('hidden');
}

// ── AI Import: Settings Modal ─────────────────────────

async function openAiSettingsModal(): Promise<void> {
  const cfg = await calBridge.aiLoadConfig();
  if (cfg) {
    qId<HTMLInputElement>('ai-apikey-input').value    = cfg.apiKey      || '';
    qId<HTMLInputElement>('ai-interests-input').value = cfg.interests   || '';
    qId<HTMLInputElement>('ai-ollama-url').value      = cfg.ollamaUrl   || 'http://localhost:11434';
    qId<HTMLInputElement>('ai-ollama-model').value    = cfg.ollamaModel || 'llama3.2';
    renderAiUrlList(cfg.sites || []);
    const providerRadio = document.querySelector(`input[name="ai-provider"][value="${cfg.provider || 'claude'}"]`) as HTMLInputElement | null;
    if (providerRadio) { providerRadio.checked = true; syncAiProviderPanel(cfg.provider || 'claude'); }
    const modeRadio = document.querySelector(`input[name="ai-mode"][value="${cfg.mode || 'fetch'}"]`) as HTMLInputElement | null;
    if (modeRadio) { modeRadio.checked = true; syncAiModePanel(cfg.mode || 'fetch'); }
  } else {
    qId<HTMLInputElement>('ai-provider-claude').checked = true;
    qId<HTMLInputElement>('ai-mode-fetch').checked      = true;
    qId<HTMLInputElement>('ai-ollama-url').value        = 'http://localhost:11434';
    qId<HTMLInputElement>('ai-ollama-model').value      = 'llama3.2';
    syncAiProviderPanel('claude');
    syncAiModePanel('fetch');
    renderAiUrlList([]);
  }
  setAiStatus('', '');
  qId('ai-overlay').classList.remove('hidden');
}

function closeAiSettingsModal(): void {
  qId('ai-overlay').classList.add('hidden');
}

function syncAiProviderPanel(provider: string): void {
  const isOllama = provider === 'ollama';
  qId('ai-claude-panel').classList.toggle('hidden', isOllama);
  qId('ai-ollama-panel').classList.toggle('hidden', !isOllama);
  // Ollama only supports fetch mode — hide the mode selector and force fetch
  qId('ai-mode-group').classList.toggle('hidden', isOllama);
  if (isOllama) {
    qId<HTMLInputElement>('ai-mode-fetch').checked = true;
    syncAiModePanel('fetch');
  }
}

function syncAiModePanel(mode: string): void {
  qId('ai-fetch-panel').classList.toggle('hidden', mode !== 'fetch');
  qId('ai-websearch-panel').classList.toggle('hidden', mode !== 'websearch');
}

function renderAiUrlList(sites: string[]): void {
  const list = qId('ai-url-list');
  list.innerHTML = '';
  sites.forEach((url, i) => {
    const row  = document.createElement('div');
    row.className = 'ai-url-row';
    const span = document.createElement('span');
    span.textContent = url;
    const btn  = document.createElement('button');
    btn.className   = 'ai-url-remove';
    btn.textContent = '\u2715';
    btn.title       = 'Remove';
    btn.addEventListener('click', () => {
      const current = getAiSitesFromList();
      current.splice(i, 1);
      renderAiUrlList(current);
    });
    row.append(span, btn);
    list.appendChild(row);
  });
}

function getAiSitesFromList(): string[] {
  return Array.from(document.querySelectorAll('.ai-url-row span')).map(s => s.textContent || '');
}

function getAiConfig(): AiConfig {
  const provider    = (document.querySelector('input[name="ai-provider"]:checked') as HTMLInputElement | null)?.value || 'claude';
  const apiKey      = qId<HTMLInputElement>('ai-apikey-input').value.trim();
  const ollamaUrl   = qId<HTMLInputElement>('ai-ollama-url').value.trim();
  const ollamaModel = qId<HTMLInputElement>('ai-ollama-model').value.trim();
  const mode        = (document.querySelector('input[name="ai-mode"]:checked') as HTMLInputElement | null)?.value || 'fetch';
  const interests   = qId<HTMLInputElement>('ai-interests-input').value.trim();
  const sites       = getAiSitesFromList();
  return { provider: provider as AiConfig['provider'], apiKey, ollamaUrl, ollamaModel, mode: mode as AiConfig['mode'], interests, sites };
}

function setAiStatus(msg: string, type: string): void {
  const el = qId('ai-status');
  el.textContent = msg;
  el.className   = 'ai-status' + (type ? ` ${type}` : '') + (msg ? '' : ' hidden');
}

async function saveAiSettings(): Promise<void> {
  const cfg = getAiConfig();
  if (cfg.provider === 'claude' && !cfg.apiKey) {
    setAiStatus('Please enter your Anthropic API key.', 'error'); return;
  }
  if (cfg.provider === 'ollama' && !cfg.ollamaUrl) {
    setAiStatus('Please enter the Ollama endpoint URL.', 'error'); return;
  }
  await calBridge.aiSaveConfig(cfg);
  setAiStatus('Settings saved.', '');
}

async function runAiImport(): Promise<void> {
  const cfg = getAiConfig();
  if (cfg.provider === 'claude' && !cfg.apiKey) {
    setAiStatus('Please enter and save your API key first.', 'error'); return;
  }
  if (cfg.provider === 'ollama' && !cfg.ollamaUrl) {
    setAiStatus('Please enter the Ollama endpoint URL.', 'error'); return;
  }
  await calBridge.aiSaveConfig(cfg);
  setAiStatus('Running import\u2026 this may take up to 30 seconds.', 'loading');
  qId<HTMLButtonElement>('ai-run-btn').disabled = true;
  try {
    const result = await calBridge.aiRunImport();
    if (result.error) { setAiStatus(`Error: ${result.error}`, 'error'); return; }
    if (!result.events?.length) { setAiStatus('No events found. Try adjusting your interests or URLs.', ''); return; }
    aiPendingEvents = result.events;
    closeAiSettingsModal();
    openAiReviewModal(result.events);
  } finally {
    qId<HTMLButtonElement>('ai-run-btn').disabled = false;
  }
}

// ── AI Import: Review Modal ───────────────────────────

function openAiReviewModal(events: AiEvent[]): void {
  const count = events.length;
  qId('ai-review-title').textContent =
    `Found ${count} Event${count === 1 ? '' : 's'}`;
  qId('ai-review-subtitle').textContent =
    'Select the events you want to add to your calendar.';
  renderAiEventList(events);
  qId('ai-review-overlay').classList.remove('hidden');
}

function closeAiReviewModal(): void {
  qId('ai-review-overlay').classList.add('hidden');
  aiPendingEvents = [];
}

function renderAiEventList(events: AiEvent[]): void {
  const list = qId('ai-event-list');
  list.innerHTML = '';
  events.forEach((ev, i) => {
    const row = document.createElement('div');
    row.className  = 'ai-event-row checked';
    row.dataset.idx = String(i);

    const cb    = document.createElement('input') as HTMLInputElement;
    cb.type     = 'checkbox';
    cb.checked  = true;
    cb.addEventListener('change', () => row.classList.toggle('checked', cb.checked));
    row.addEventListener('click', (e: MouseEvent) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    const info  = document.createElement('div');
    info.className = 'ai-event-info';

    const title = document.createElement('div');
    title.className   = 'ai-event-title';
    title.textContent = ev.title;

    const meta  = document.createElement('div');
    meta.className = 'ai-event-meta';
    let metaText = formatDisplayDate(ev.date);
    if (ev.time) metaText += ' \u00b7 ' + formatTime12h(ev.time);
    meta.textContent = metaText;
    if (ev.sourceUrl) {
      let hostname = ev.sourceUrl;
      try { hostname = new URL(ev.sourceUrl).hostname; } catch {}
      const sep  = document.createTextNode(' \u00b7 ');
      const link = document.createElement('span');
      link.className   = 'ai-event-link';
      link.textContent = hostname;
      link.title       = ev.sourceUrl;
      link.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation(); // don't toggle the checkbox
        calBridge.openExternal(ev.sourceUrl);
      });
      meta.append(sep, link);
    }

    const notes = document.createElement('div');
    notes.className   = 'ai-event-notes';
    notes.textContent = ev.notes;
    if (!ev.notes) notes.style.display = 'none';

    info.append(title, meta, notes);
    row.append(cb, info);
    list.appendChild(row);
  });
}

async function addSelectedAiEvents(): Promise<void> {
  const rows = Array.from(document.querySelectorAll('#ai-event-list .ai-event-row.checked')) as HTMLElement[];
  if (!rows.length) { closeAiReviewModal(); return; }
  pushCalendarSnapshot();
  for (const row of rows) {
    const ev  = aiPendingEvents[parseInt(row.dataset.idx!)];
    if (!ev) continue;
    const day = getOrInitDayData(ev.date);
    const id  = generateCalendarEntryId();
    const noteParts = [ev.title, ev.notes, ev.sourceUrl].filter(Boolean);
    day.events.push({ id, image: null, notes: noteParts.join('\n'), time: ev.time || '' });
    if (!day.featuredId) day.featuredId = id;
  }
  await saveCalendarData();
  renderCalendarGrid();
  renderMonthStrip();
  closeAiReviewModal();
}

function renderSkinGrid(): void {
  const grid    = qId('skin-grid');
  grid.innerHTML = '';
  const current = getCurrentSkin();

  Object.values(SKINS).forEach(skin => {
    const card = document.createElement('button');
    card.className   = 'skin-card' + (skin.id === current ? ' active' : '');
    card.dataset.skinId = skin.id;

    const preview = document.createElement('div');
    preview.className = `skin-preview skin-preview-${skin.id}`;

    const label = document.createElement('span');
    label.textContent = skin.label;

    card.append(preview, label);
    card.addEventListener('click', () => {
      activateSkin(skin.id);
      renderSkinGrid();
      // Re-render grid so cell animation delays apply/remove correctly
      renderCalendarGrid();
    });
    grid.appendChild(card);
  });
}

// ── Glass: button light-follow effect ──────────────────
function bindGlassButtonLightFollow(): void {
  const selector = [
    '#win-controls button',
    '.nav-arrow',
    '.month-tab',
    '.view-tab',
    '.ampm-btn',
    '#btn-add-event',
    '#btn-schedule-day',
  ].join(', ');

  // Throttle to one update per animation frame — getBoundingClientRect + setProperty
  // on every raw mousemove (60+ Hz) causes measurable layout thrashing on glass skin.
  let glassLightRafPending = false;
  let glassLightLastEvent: MouseEvent | null  = null;

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!document.body.classList.contains('skin-glass')) return;
    glassLightLastEvent = e;
    if (glassLightRafPending) return;
    glassLightRafPending = true;
    requestAnimationFrame(() => {
      glassLightRafPending = false;
      const ev  = glassLightLastEvent;
      if (!ev) return;
      const btn = (ev.target as Element).closest(selector) as HTMLElement | null;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty('--mx', ((ev.clientX - rect.left) / rect.width  * 100) + '%');
      btn.style.setProperty('--my', ((ev.clientY - rect.top)  / rect.height * 100) + '%');
    });
  });
}

function changeMonth(delta: number): void {
  viewMonth += delta;
  if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
  renderMonthStrip();
  renderCalendarGrid();
  if (activeView !== 'calendar') switchCalendarView('calendar');
}

function changeYear(delta: number): void {
  viewYear += delta;
  renderMonthStrip();
  renderCalendarGrid();
  if (activeView !== 'calendar') switchCalendarView('calendar');
}

// ── Day-change watcher ─────────────────────────────────
// Keeps the today-highlight accurate after midnight or a system sleep/wake cycle.
// visibilitychange fires immediately when the window regains focus (e.g. wake from sleep),
// which is faster and more reliable than waiting for the next 60-second poll tick.
function startDayChangeWatcher(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getTodayKey() !== renderedTodayKey) {
      renderCalendarGrid();
    }
  });
  // Fallback: poll every 60 s to catch midnight rollover while the app stays visible
  setInterval(() => {
    if (getTodayKey() !== renderedTodayKey) renderCalendarGrid();
  }, 60_000);
}

// ── View switching ──────────────────────────────────────
function switchCalendarView(view: ViewType): void {
  activeView = view;
  qId('calendar-wrapper').classList.toggle('hidden', view !== 'calendar');
  qId('schedule-view').classList.toggle('hidden', view !== 'schedule');
  (document.querySelectorAll('.view-tab') as NodeListOf<HTMLElement>).forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );
  if (view === 'schedule') {
    if (!scheduleDate) scheduleDate = getTodayKey();
    (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>).forEach(b =>
      b.classList.toggle('active', b.dataset.ampm === clockAmPm)
    );
    renderScheduleView(scheduleDate);
  }
}

function stepScheduleDay(delta: number): void {
  if (!scheduleDate) scheduleDate = getTodayKey();
  const [y, m, d] = scheduleDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  scheduleDate = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  renderScheduleView(scheduleDate);
}

// ── Schedule / Clock rendering ──────────────────────────
function renderScheduleView(key: string): void {
  scheduleDate = key;
  if (rescheduleBlock && rescheduleBlock._key !== key) rescheduleBlock = null;

  qId('sched-date-label').textContent = formatDisplayDate(key);
  const area = qId('clock-area');
  area.innerHTML = '';

  const allDateBlocks = getDayData(key)?.timeBlocks || [];
  const recurBlocks   = getRecurringBlocksForDate(key).map(b => ({
    ...b,
    completed:  b.completedDates?.includes(key) || false,
    _recurring: true,
  }));
  const allBlocks     = [...allDateBlocks, ...recurBlocks];
  const visibleBlocks = allBlocks.filter(b => (b as BlockOrPartial & { ampm?: AmPm }).ampm === clockAmPm);
  // PM clock also renders AM blocks as dimmed overlays — they're always in the past and
  // occupy the same angular positions as their PM counterparts (startMin/endMin are shared
  // 12-hr coordinates). Draw them first so PM blocks layer on top.
  const clockBlocks = clockAmPm === 'PM'
    ? [...allBlocks.filter(b => (b as BlockOrPartial & { ampm?: AmPm }).ampm === 'AM').map(b => ({ ...b, _amOverlay: true })),
       ...visibleBlocks]
    : visibleBlocks;
  const svg           = buildClockSVG(key, clockBlocks as BlockOrPartial[]);
  area.appendChild(svg);
  updateClockHand();

  renderBlockLegend(key, visibleBlocks as (TimeBlock & { _recurring?: boolean })[],  svg);
  renderTaskList(key, allBlocks as (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean })[],  svg);
  updateRescheduleBanner();
}

function buildClockSVG(key: string, blocks: BlockOrPartial[]): SVGSVGElement {
  const VB = 400, cx = 200, cy = 200, R = 170;
  const r1 = Math.round(R * 0.62);   // inner ring ≈ 105
  const r2 = Math.round(R * 0.85);   // outer ring ≈ 145

  const svg = svgEl('svg', { viewBox: `0 0 ${VB} ${VB}` }) as SVGSVGElement;

  // Defs (for arc label text paths)
  const defs = svgEl('defs', {});
  svg.appendChild(defs);

  // Background circle that defines the clock's visual boundary
  svg.appendChild(svgEl('circle', { class: 'clock-face', cx, cy, r: R }));

  // Hour ticks + numbers (1–11 in loop, 12 separate)
  for (let h = 0; h < 12; h++) {
    const ang      = (h / 12) * 2 * Math.PI - Math.PI / 2;
    const cos      = Math.cos(ang), sin = Math.sin(ang);
    const isMajor  = h % 3 === 0;
    const tickIn   = R * (isMajor ? 0.88 : 0.91);
    const tickOut  = R * 0.975;

    svg.appendChild(svgEl('line', {
      class: isMajor ? 'clock-tick clock-tick-major' : 'clock-tick',
      x1: cx + tickIn * cos,  y1: cy + tickIn * sin,
      x2: cx + tickOut * cos, y2: cy + tickOut * sin,
    }));

    const label = h === 0 ? '12' : String(h);
    const numR  = R * 0.73;
    const txt   = svgEl('text', { class: 'clock-num', x: cx + numR * cos, y: cy + numR * sin });
    txt.textContent = label;
    svg.appendChild(txt);
  }

  // Existing time blocks (drawn below preview + hand)
  blocks.forEach(block => {
    const blockAny = block as BlockOrPartial & { _amOverlay?: boolean; _recurring?: boolean; label?: string; id?: string; recurrence?: string; color?: string };
    const isRescheduling = rescheduleBlock?.id === blockAny.id;
    const isPast         = isPastBlock(block as TimeBlock);

    // Wrap arc + label in a group so opacity/pointer-events apply to both.
    // AM overlays on PM clock get their own class (readable dimmed opacity).
    // Regular past blocks use crossover-arc (near-zero — signals done).
    const dimClass = blockAny._amOverlay ? 'am-overlay-arc'
                   : isPast              ? 'crossover-arc'
                   :                       '';
    const g = svgEl('g', {
      class: [isRescheduling ? 'rescheduling-arc' : '', dimClass].filter(Boolean).join(' '),
    });
    // AM overlays are read-only; am-overlay-arc sets pointer-events:none,
    // but skip attaching handlers entirely to keep things clean
    if (!blockAny._amOverlay) {
      g.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        showTimeBlockPopup('edit', block, key, svg, cx, cy, R);
      });
      g.addEventListener('mouseenter', () => { hoveredClockBlock = { block: block as TimeBlock | RecurringBlock, key }; });
      g.addEventListener('mouseleave', () => { hoveredClockBlock = null; });
    }

    const path = svgEl('path', {
      class: 'clock-block-arc' + (blockAny._recurring ? ' recurring-arc' : ''),
      d:    arcPath(cx, cy, r1, r2, block.startMin, block.endMin, document.body.classList.contains('skin-glass') ? 6 : 0),
      fill: blockAny.color || '#888',
    });
    g.appendChild(path);

    // Label follows the arc's curve so text reads naturally inside the block's shape
    const spanMin = (block.endMin - block.startMin + 720) % 720;
    if (spanMin >= 30 && blockAny.label) {
      const rMid    = (r1 + r2) / 2;
      const arcLen  = (spanMin / 720) * 2 * Math.PI * rMid;
      const maxChars = Math.max(1, Math.floor(arcLen / 7));
      const display  = blockAny.label.length > maxChars
        ? blockAny.label.slice(0, maxChars - 1) + '\u2026'
        : blockAny.label;

      const startAng = (block.startMin / 720) * 2 * Math.PI - Math.PI / 2;
      const endAng   = startAng + (spanMin / 720) * 2 * Math.PI;
      const large    = spanMin > 360 ? 1 : 0;
      const lx1 = cx + rMid * Math.cos(startAng), ly1 = cy + rMid * Math.sin(startAng);
      const lx2 = cx + rMid * Math.cos(endAng),   ly2 = cy + rMid * Math.sin(endAng);
      const pathId = `arc-label-path-${blockAny.id}`;

      defs.appendChild(svgEl('path', { id: pathId, d: `M ${lx1} ${ly1} A ${rMid} ${rMid} 0 ${large} 1 ${lx2} ${ly2}` }));

      const tp = svgEl('textPath', { href: `#${pathId}`, startOffset: '50%', 'text-anchor': 'middle' });
      tp.textContent = display;
      const textEl = svgEl('text', { class: 'clock-block-label' });
      textEl.appendChild(tp);
      g.appendChild(textEl);
    }

    svg.appendChild(g);
  });

  // Pre-created path updated during drag so we don't create/destroy SVG nodes on every mousemove
  const preview = svgEl('path', { id: 'clock-preview-arc', class: 'clock-preview', fill: '#888', d: '' });
  svg.appendChild(preview);

  // Drawn above blocks so the hand is always visible regardless of how many arcs are stacked
  const hand = svgEl('line', { id: 'clock-hand', class: 'clock-hand', x1: cx, y1: cy, x2: cx, y2: cy });
  svg.appendChild(hand);

  // Covers the arc endpoints that converge at center, hiding the jagged joins
  svg.appendChild(svgEl('circle', { class: 'clock-hand-dot', cx, cy, r: 2}));

  bindClockInteraction(svg, cx, cy, r1, r2, key);
  return svg;
}

// ── Clock arc geometry ──────────────────────────────────
function arcPath(cx: number, cy: number, r1: number, r2: number, startMin: number, endMin: number, rnd = 0): string {
  const spanMin  = (endMin - startMin + 720) % 720;
  if (spanMin === 0) return '';
  const startAng = (startMin / 720) * 2 * Math.PI - Math.PI / 2;
  const endAng   = startAng + (spanMin / 720) * 2 * Math.PI;
  const large    = spanMin > 360 ? 1 : 0;
  const c1 = Math.cos(startAng), s1 = Math.sin(startAng);
  const c2 = Math.cos(endAng),   s2 = Math.sin(endAng);

  const ox1 = cx + r2 * c1, oy1 = cy + r2 * s1;
  const ox2 = cx + r2 * c2, oy2 = cy + r2 * s2;
  const ix1 = cx + r1 * c2, iy1 = cy + r1 * s2;
  const ix2 = cx + r1 * c1, iy2 = cy + r1 * s1;

  if (rnd <= 0) {
    return `M ${ox1} ${oy1} A ${r2} ${r2} 0 ${large} 1 ${ox2} ${oy2} ` +
           `L ${ix1} ${iy1} A ${r1} ${r1} 0 ${large} 0 ${ix2} ${iy2} Z`;
  }

  // Rounded corners: replace each sharp corner with a quadratic bezier.
  // At each corner the approach/depart points are r units back along the
  // incoming and outgoing directions; the sharp corner is the control point.
  //
  // CW tangent at angle θ (SVG Y-down): (-sin θ, cos θ)
  // Radial outward at θ:                 (cos θ,  sin θ)
  const r = Math.min(rnd, (r2 - r1) * 0.45);
  const p = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;

  // Corner A (ox1,oy1): arrives radially outward (c1,s1), departs CW tangent (-s1,c1)
  const Aa: [number, number] = [ox1 - r * c1,  oy1 - r * s1];
  const Ad: [number, number] = [ox1 - r * s1,  oy1 + r * c1];

  // Corner B (ox2,oy2): arrives CW tangent (-s2,c2), departs radially inward (-c2,-s2)
  const Ba: [number, number] = [ox2 + r * s2,  oy2 - r * c2];
  const Bd: [number, number] = [ox2 - r * c2,  oy2 - r * s2];

  // Corner C (ix1,iy1): arrives radially inward (-c2,-s2), departs CCW tangent (s2,-c2)
  const Ca: [number, number] = [ix1 + r * c2,  iy1 + r * s2];
  const Cd: [number, number] = [ix1 + r * s2,  iy1 - r * c2];

  // Corner D (ix2,iy2): arrives CCW tangent (s1,-c1), departs radially outward (c1,s1)
  const Da: [number, number] = [ix2 - r * s1,  iy2 + r * c1];
  const Dd: [number, number] = [ix2 + r * c1,  iy2 + r * s1];

  return (
    `M ${p(...Ad)} ` +
    `A ${r2} ${r2} 0 ${large} 1 ${p(...Ba)} ` +
    `Q ${p(ox2, oy2)} ${p(...Bd)} ` +
    `L ${p(...Ca)} ` +
    `Q ${p(ix1, iy1)} ${p(...Cd)} ` +
    `A ${r1} ${r1} 0 ${large} 0 ${p(...Da)} ` +
    `Q ${p(ix2, iy2)} ${p(...Dd)} ` +
    `L ${p(...Aa)} ` +
    `Q ${p(ox1, oy1)} ${p(...Ad)} Z`
  );
}

// Convert screen mouse event to SVG viewBox coordinates
function svgPoint(svg: SVGSVGElement, e: MouseEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (400 / rect.width),
    y: (e.clientY - rect.top)  * (400 / rect.height),
  };
}

// Cursor position → 12-hour clock minutes (snapped to 15)
function minutesFromPoint(cx: number, cy: number, px: number, py: number): number {
  const ang = Math.atan2(py - cy, px - cx) + Math.PI / 2;
  const raw = ((ang / (2 * Math.PI)) * 720 + 720) % 720;
  return Math.round(raw / 15) * 15 % 720;
}

// ── Clock drag interaction ──────────────────────────────
function bindClockInteraction(svg: SVGSVGElement, cx: number, cy: number, r1: number, r2: number, key: string): void {
  svg.addEventListener('mousedown', (e: MouseEvent) => {
    if (timeBlockPopupState) return;
    const pt   = svgPoint(svg, e);
    const dist = Math.hypot(pt.x - cx, pt.y - cy);
    if (dist < r1 - 10 || dist > r2 + 10) return;

    const startMin     = minutesFromPoint(cx, cy, pt.x, pt.y);
    const previewPath  = document.getElementById('clock-preview-arc') as SVGPathElement | null;
    const previewColor = BLOCK_COLORS[(getDayData(key)?.timeBlocks?.length || 0) % BLOCK_COLORS.length];
    previewPath?.setAttribute('fill', previewColor);

    let lastMin = startMin;

    function onClockDragMove(ev: MouseEvent): void {
      const pt2 = svgPoint(svg, ev);
      lastMin   = minutesFromPoint(cx, cy, pt2.x, pt2.y);
      const span = (lastMin - startMin + 720) % 720;
      previewPath?.setAttribute('d', span >= 15 ? arcPath(cx, cy, r1, r2, startMin, lastMin) : '');
    }

    function onClockDragEnd(): void {
      document.removeEventListener('mousemove', onClockDragMove);
      document.removeEventListener('mouseup', onClockDragEnd);
      previewPath?.setAttribute('d', '');
      clockDragState = null;

      const endMin = lastMin;
      const span   = (endMin - startMin + 720) % 720;
      if (span < 15) return;
      showTimeBlockPopup('new', { startMin, endMin }, key, svg, cx, cy, 170);
    }

    clockDragState = { startMin, svg };
    document.addEventListener('mousemove', onClockDragMove);
    document.addEventListener('mouseup', onClockDragEnd);
    e.preventDefault();
  });
}

// ── Block popup ─────────────────────────────────────────
function showTimeBlockPopup(mode: 'new' | 'edit', blockOrData: BlockOrPartial, key: string, svg: SVGSVGElement, cx: number, cy: number, R: number): void {
  const popup          = qId('block-label-popup');
  const input          = qId<HTMLInputElement>('block-label-input');
  const confirmBtn     = qId('block-label-confirm');
  const delBtn         = qId('block-label-del');
  const recurSel       = qId<HTMLSelectElement>('block-recurrence-select');
  const scopeRow       = qId('block-scope-row');
  const { startMin, endMin, id, label } = blockOrData as BlockOrPartial & { id?: string; label?: string };
  const blockAny       = blockOrData as BlockOrPartial & { _recurring?: boolean; recurrence?: string };
  const isRecurring    = !!blockAny._recurring;

  timeBlockPopupState = { mode, key, startMin, endMin, id };
  input.value    = label || '';
  recurSel.value = isRecurring ? (blockAny.recurrence || 'daily') : 'none';

  // Scope row: visible only when editing an existing recurring block
  if (mode === 'edit' && isRecurring) {
    scopeRow.classList.remove('hidden');
    (scopeRow.querySelector('input[value="all"]') as HTMLInputElement).checked = true;
  } else {
    scopeRow.classList.add('hidden');
  }

  // Position near arc midpoint (SVG → screen)
  const spanMin = (endMin - startMin + 720) % 720;
  const midMin  = (startMin + spanMin / 2) % 720;
  const ang     = (midMin / 720) * 2 * Math.PI - Math.PI / 2;
  const r       = (R * 0.62 + R * 0.85) / 2;
  const rect    = svg.getBoundingClientRect();
  const sx      = rect.left + (cx + r * Math.cos(ang)) * (rect.width  / 400);
  const sy      = rect.top  + (cy + r * Math.sin(ang)) * (rect.height / 400);

  popup.style.left = Math.min(sx - 10,  window.innerWidth  - 260) + 'px';
  popup.style.top  = Math.min(sy - 20,  window.innerHeight - 180) + 'px';
  delBtn.title = mode === 'new' ? 'Cancel' : 'Delete block';

  popup.classList.remove('hidden');
  input.focus();

  function getSelectedBlockScope(): string {
    return (scopeRow.querySelector('input[name="block-scope"]:checked') as HTMLInputElement | null)?.value || 'all';
  }

  function commitBlockEdit(): void {
    const lbl        = input.value.trim();
    const recurrence = recurSel.value;
    const scope      = getSelectedBlockScope();
    closeTimeBlockPopup();
    if (!lbl) {
      if (mode === 'edit' && id) deleteTimeBlock(key, id, isRecurring ? scope : undefined);
      return;
    }
    if (mode === 'new') {
      saveTimeBlock(key, { startMin, endMin, label: lbl }, recurrence);
    } else if (mode === 'edit' && id) {
      updateTimeBlock(key, id, lbl, recurrence, scope);
    }
  }

  function onBlockLabelKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter')  { ev.preventDefault(); commitBlockEdit(); }
    if (ev.key === 'Escape') { closeTimeBlockPopup(); }
  }
  // Delay blur so the delete-button click fires first;
  // only commit if focus has moved outside the popup entirely (not to the select/radios inside it)
  function onBlockLabelBlur(): void { setTimeout(() => { if (timeBlockPopupState && !popup.contains(document.activeElement)) commitBlockEdit(); }, 150); }
  function onBlockDeleteClick(): void  {
    const scope = getSelectedBlockScope();
    closeTimeBlockPopup();
    if (mode === 'edit' && id) deleteTimeBlock(key, id, isRecurring ? scope : undefined);
  }

  input.addEventListener('keydown',    onBlockLabelKeyDown);
  input.addEventListener('blur',       onBlockLabelBlur);
  confirmBtn.addEventListener('click', commitBlockEdit);
  delBtn.addEventListener('click',     onBlockDeleteClick);

  // When recurrence select changes, show/hide scope row accordingly
  function onBlockRecurrenceChange(): void {
    if (mode === 'edit' && isRecurring) {
      // scope row stays visible regardless (block is already recurring)
    } else {
      // for new blocks or non-recurring edits, no scope needed
      scopeRow.classList.add('hidden');
    }
  }
  recurSel.addEventListener('change', onBlockRecurrenceChange);

  timeBlockPopupState._cleanup = () => {
    input.removeEventListener('keydown',    onBlockLabelKeyDown);
    input.removeEventListener('blur',       onBlockLabelBlur);
    confirmBtn.removeEventListener('click', commitBlockEdit);
    delBtn.removeEventListener('click',     onBlockDeleteClick);
    recurSel.removeEventListener('change',  onBlockRecurrenceChange);
  };
}

function closeTimeBlockPopup(): void {
  const popup = qId('block-label-popup');
  popup.classList.add('hidden');
  if (timeBlockPopupState?._cleanup) timeBlockPopupState._cleanup();
  timeBlockPopupState = null;
}

// ── Time block data operations ──────────────────────────
async function saveTimeBlock(key: string, { startMin, endMin, label }: { startMin: number; endMin: number; label: string }, recurrence = 'none'): Promise<void> {
  pushCalendarSnapshot();
  const ampm = inferBlockAmPm(startMin);
  if (recurrence === 'none') {
    const day   = getOrInitDayData(key);
    const color = BLOCK_COLORS[day.timeBlocks.length % BLOCK_COLORS.length];
    day.timeBlocks.push({ id: generateCalendarEntryId(), startMin, endMin, label, color, ampm, completed: false });
  } else {
    if (!calData._recurring) calData._recurring = [];
    const color = BLOCK_COLORS[calData._recurring.length % BLOCK_COLORS.length];
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    calData._recurring.push({
      id: generateCalendarEntryId(), startMin, endMin, label, color, ampm,
      recurrence: recurrence as RecurringBlock['recurrence'],
      dayOfWeek:  date.getDay(),
      dayOfMonth: d,
      completedDates: [],
      excludedDates:  [],
    });
  }
  await saveCalendarData();
  // If the inferred period differs from the current clock view, switch to show the new block
  if (ampm !== clockAmPm) {
    clockAmPm = ampm;
    (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>)
      .forEach(b => b.classList.toggle('active', b.dataset.ampm === clockAmPm));
  }
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

async function updateTimeBlock(key: string, blockId: string, label: string, recurrence: string, scope: string): Promise<void> {
  pushCalendarSnapshot();
  const recurring    = calData._recurring || [];
  const rIdx         = recurring.findIndex(b => b.id === blockId);
  const isRecurring  = rIdx !== -1;

  if (isRecurring) {
    const block = recurring[rIdx];
    if (scope === 'today') {
      // Exclude today from recurrence; create a one-off override on this date
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
      const day = getOrInitDayData(key);
      day.timeBlocks.push({
        id: generateCalendarEntryId(), startMin: block.startMin, endMin: block.endMin,
        label, color: block.color, ampm: block.ampm, completed: false,
      });
    } else {
      // Update the template for all occurrences
      block.label = label;
      if (recurrence === 'none') {
        // Convert to a one-off block on the current view date
        recurring.splice(rIdx, 1);
        const day = getOrInitDayData(key);
        const completed = block.completedDates?.includes(key) || false;
        day.timeBlocks.push({
          id: block.id, startMin: block.startMin, endMin: block.endMin,
          label, color: block.color, ampm: block.ampm, completed,
        });
      } else {
        block.recurrence = recurrence as RecurringBlock['recurrence'];
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        block.dayOfWeek  = date.getDay();
        block.dayOfMonth = d;
      }
    }
  } else {
    // Block lives on a single date in calData[key].timeBlocks, not in calData._recurring
    const block = getDayData(key)?.timeBlocks?.find(b => b.id === blockId);
    if (!block) return;
    block.label = label;
    if (recurrence !== 'none') {
      // Move the block out of date-specific storage and into calData._recurring
      const day = getDayData(key)!;
      day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
      if (!calData._recurring) calData._recurring = [];
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      calData._recurring.push({
        id: block.id, startMin: block.startMin, endMin: block.endMin,
        label, color: block.color, ampm: block.ampm,
        recurrence: recurrence as RecurringBlock['recurrence'],
        dayOfWeek:  date.getDay(),
        dayOfMonth: d,
        completedDates: block.completed ? [key] : [],
        excludedDates:  [],
      });
    }
  }
  await saveCalendarData();
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}

async function deleteTimeBlock(key: string, blockId: string, scope?: string): Promise<void> {
  pushCalendarSnapshot();
  const recurring = calData._recurring || [];
  const rIdx      = recurring.findIndex(b => b.id === blockId);
  if (rIdx !== -1) {
    // scope: 'today' = exclude this date; 'all' or undefined = remove template
    // 'prompt' = called from task list delete button (treat same as 'all' — popup handles scoping)
    if (scope === 'today') {
      const block = recurring[rIdx];
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
    } else {
      recurring.splice(rIdx, 1);
    }
    await saveCalendarData();
    if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    return;
  }
  const day = getDayData(key);
  if (!day?.timeBlocks) return;
  day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
  await saveCalendarData();
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

// ── Block legend ────────────────────────────────────────
function renderBlockLegend(key: string, blocks: (TimeBlock & { _recurring?: boolean })[], svg: SVGSVGElement): void {
  const legend = qId('block-legend');
  legend.innerHTML = '';

  if (!blocks.length) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:12px;color:var(--text-muted)';
    hint.textContent   = 'Drag on the clock ring to add a time block';
    legend.appendChild(hint);
    return;
  }

  blocks.forEach(block => {
    const chip = document.createElement('span');
    chip.className   = 'block-chip';
    chip.textContent = block._recurring ? block.label + ' \u21BB' : block.label;
    chip.style.background = block.color;
    chip.title = `${formatClockMinutes(block.startMin)} – ${formatClockMinutes(block.endMin, block.ampm)}`;
    chip.addEventListener('click', () => showTimeBlockPopup('edit', block, key, svg, 200, 200, 170));
    legend.appendChild(chip);
  });
}

function formatClockMinutes(min: number, ampm = ''): string {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = min % 60;
  const base = `${h}:${String(m).padStart(2, '0')}`;
  return ampm ? `${base} ${ampm}` : base;
}

// ── Task list sidebar ───────────────────────────────────
function renderTaskList(key: string, allBlocks: (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean })[], svg: SVGSVGElement): void {
  const list = qId('task-list');
  list.innerHTML = '';

  if (!allBlocks.length) {
    const empty = document.createElement('div');
    empty.className   = 'task-empty';
    empty.textContent = 'No blocks scheduled.\nDrag the clock ring to add one.';
    list.appendChild(empty);
    return;
  }

  // Sort: AM blocks first (by startMin), then PM blocks (by startMin)
  const sorted = [...allBlocks].sort((a, b) => {
    const aOrd = (a.ampm === 'PM' ? 720 : 0) + a.startMin;
    const bOrd = (b.ampm === 'PM' ? 720 : 0) + b.startMin;
    return aOrd - bOrd;
  });

  sorted.forEach(block => {
    const past = isPastBlock(block) && !block.completed;

    const item = document.createElement('div');
    item.className = 'task-item' +
      (block.completed ? ' completed' : '') +
      (past ? ' past' : '');

    const swatch = document.createElement('div');
    swatch.className        = 'task-color-swatch';
    swatch.style.background = block.color;

    const body = document.createElement('div');
    body.className = 'task-body';

    const lbl = document.createElement('div');
    lbl.className = 'task-label';
    lbl.textContent = block.label;
    if (block._recurring) {
      const badge = document.createElement('span');
      badge.className   = 'task-recur-badge';
      badge.textContent = '\u21BB'; // ↻
      lbl.appendChild(badge);
    }

    const timeEl = document.createElement('div');
    timeEl.className   = 'task-time';
    timeEl.textContent = `${formatClockMinutes(block.startMin)} – ${formatClockMinutes(block.endMin, block.ampm)}`;

    body.append(lbl, timeEl);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const btnComplete = document.createElement('button');
    btnComplete.className   = 'task-btn';
    btnComplete.title       = block.completed ? 'Mark incomplete' : 'Mark complete';
    btnComplete.textContent = block.completed ? '\u21BA' : '\u2713'; // ↺ / ✓
    btnComplete.addEventListener('click', () => toggleBlockCompleted(key, block.id));

    const btnReschedule = document.createElement('button');
    btnReschedule.className   = 'task-btn';
    btnReschedule.title       = 'Move to another day';
    btnReschedule.textContent = '\u29C9'; // ⧉ (move/copy icon)
    btnReschedule.addEventListener('click', () => startReschedule(block, key));
    if (block._recurring) btnReschedule.style.display = 'none';

    const btnDel = document.createElement('button');
    btnDel.className   = 'task-btn task-btn-del';
    btnDel.title       = 'Delete block';
    btnDel.textContent = '\u00D7'; // ×
    btnDel.addEventListener('click', () => {
      if (block._recurring) {
        // Show inline scope choice: Today / All / Cancel
        const todayBtn = document.createElement('button');
        todayBtn.className   = 'task-btn';
        todayBtn.textContent = 'Today';
        todayBtn.title       = 'Remove just from this day';
        todayBtn.addEventListener('click', () => deleteTimeBlock(key, block.id, 'today'));

        const allBtn = document.createElement('button');
        allBtn.className   = 'task-btn task-btn-del';
        allBtn.textContent = 'All';
        allBtn.title       = 'Remove from all days';
        allBtn.addEventListener('click', () => deleteTimeBlock(key, block.id, 'all'));

        const cancelBtn = document.createElement('button');
        cancelBtn.className   = 'task-btn';
        cancelBtn.textContent = '\u21A9'; // ↩
        cancelBtn.title       = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
        });

        actions.innerHTML = '';
        actions.append(todayBtn, allBtn, cancelBtn);
      } else {
        deleteTimeBlock(key, block.id);
      }
    });

    actions.append(btnComplete, btnReschedule, btnDel);
    item.append(swatch, body, actions);
    list.appendChild(item);
  });
}

// ── Block state helpers ─────────────────────────────────
// Infer whether a block drawn at `startMin` belongs to AM or PM.
// Compares both 12-hr interpretations against the current wall-clock time:
//   - one past, one future → pick the future one
//   - both past or both future → fall back to the current clock mode
function inferBlockAmPm(startMin: number): AmPm {
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const amStart = startMin;
  const pmStart = startMin + 720;
  if (amStart < nowMin && pmStart >= nowMin) return 'PM';
  if (pmStart < nowMin && amStart >= nowMin) return 'AM';
  return clockAmPm;
}

function isPastBlock(block: TimeBlock | (BlockOrPartial & { ampm?: AmPm })): boolean {
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const ampm   = (block as BlockOrPartial & { ampm?: AmPm }).ampm;
  let endMin   = ampm === 'PM' ? block.endMin + 720 : block.endMin;
  // AM block crossing noon (e.g. 10 AM→12 PM): endMin wraps to a value < startMin on the 12-hr face
  if (ampm === 'AM' && block.endMin < block.startMin) {
    endMin = block.endMin + 720;
  }
  return nowMin >= endMin;
}

async function toggleBlockCompleted(key: string, blockId: string): Promise<void> {
  pushCalendarSnapshot();
  const rBlock = (calData._recurring || []).find(b => b.id === blockId);
  if (rBlock) {
    if (!rBlock.completedDates) rBlock.completedDates = [];
    const idx = rBlock.completedDates.indexOf(key);
    if (idx === -1) rBlock.completedDates.push(key);
    else            rBlock.completedDates.splice(idx, 1);
    await saveCalendarData();
    if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    return;
  }
  const block = getDayData(key)?.timeBlocks?.find(b => b.id === blockId);
  if (!block) return;
  block.completed = !block.completed;
  await saveCalendarData();
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

// ── Reschedule (move to another day) ───────────────────
function startReschedule(block: TimeBlock & { _recurring?: boolean }, key: string): void {
  rescheduleBlock = { ...block, _key: key };
  updateRescheduleBanner();
  renderScheduleView(key);
}

function updateRescheduleBanner(): void {
  const banner = qId('reschedule-banner');
  if (!rescheduleBlock) { banner.classList.add('hidden'); return; }

  banner.classList.remove('hidden');
  qId('reschedule-label').textContent = rescheduleBlock.label;

  // Default date input to tomorrow (or today if not set)
  const input = qId<HTMLInputElement>('reschedule-date-input');
  if (!input.value) {
    const src   = rescheduleBlock._key.split('-').map(Number);
    const dt    = new Date(src[0], src[1] - 1, src[2] + 1);
    input.value = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }
}

async function confirmReschedule(): Promise<void> {
  if (!rescheduleBlock) return;
  pushCalendarSnapshot();
  const input   = qId<HTMLInputElement>('reschedule-date-input');
  const newKey  = input.value;
  if (!newKey || newKey === rescheduleBlock._key) { cancelReschedule(); return; }

  const { id, startMin, endMin, label, color, ampm, completed, _key: oldKey } = rescheduleBlock;

  // Remove from old day without full re-render yet
  const oldDay = getDayData(oldKey);
  if (oldDay?.timeBlocks) {
    oldDay.timeBlocks = oldDay.timeBlocks.filter(b => b.id !== id);
    if (!oldDay.timeBlocks.length && !oldDay.events?.length) delete calData[oldKey];
  }

  // Add to new day (keep same id so it's clearly the same block)
  const newDay = getOrInitDayData(newKey);
  newDay.timeBlocks.push({ id, startMin, endMin, label, color, ampm, completed: completed || false });

  rescheduleBlock = null;
  await saveCalendarData();
  renderScheduleView(scheduleDate!); // stay on current day view; new day visible when navigated
}

function cancelReschedule(): void {
  rescheduleBlock = null;
  const banner = document.getElementById('reschedule-banner');
  if (banner) banner.classList.add('hidden');
  qId<HTMLInputElement>('reschedule-date-input').value = '';
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}

// ── Current time hand ───────────────────────────────────
// fromInterval=true only when called from setInterval — prevents overriding manual AM/PM toggles
function updateClockHand(fromInterval = false): void {
  const hand = document.getElementById('clock-hand') as SVGLineElement | null;
  if (!hand) return;
  const now = new Date();
  const min = (now.getHours() % 12) * 60 + now.getMinutes();
  const ang = (min / 720) * 2 * Math.PI - Math.PI / 2;
  const cx = 200, cy = 200, R = 170;
  const r1 = Math.round(R * 0.62);
  hand.setAttribute('x1', String(cx + 10 * Math.cos(ang)));
  hand.setAttribute('y1', String(cy + 10 * Math.sin(ang)));
  hand.setAttribute('x2', String(cx + r1 * Math.cos(ang)));
  hand.setAttribute('y2', String(cy + r1 * Math.sin(ang)));

  // Auto-switch AM/PM only from the interval timer, so manual toggles are respected
  if (fromInterval) {
    const expected: AmPm = now.getHours() < 12 ? 'AM' : 'PM';
    if (clockAmPm !== expected) {
      clockAmPm = expected;
      (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>)
        .forEach(b => b.classList.toggle('active', b.dataset.ampm === clockAmPm));
      if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    }
  }
}

// ── Start ──────────────────────────────────────────────
initCalendarApp();
startDayChangeWatcher();
setInterval(() => updateClockHand(true), 60_000);
