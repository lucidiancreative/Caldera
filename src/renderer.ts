/* --------------------------------------------------------
   Caldera – renderer.ts
   Multi-event calendar: each day holds an array of events.
   Data shape per day:
     { events: [{ id, image, time, notes }], featuredId }
-------------------------------------------------------- */

// Types are provided globally by src/renderer-globals.d.ts — no import needed.
// Keeping this file import-free prevents TypeScript from emitting a CommonJS
// module wrapper (`Object.defineProperty(exports, ...)`) which would crash in
// a plain <script> tag context where `exports` is not defined.

// -- Local interfaces ------------------------------------

interface Skin {
  id: SkinId;
  label: string;
  init: () => void;
  destroy: () => void;
  /** When true, activateSkin also adds skin-glass so all shared glass CSS rules apply */
  glassVariant?: boolean;
}

/** Cosine-palette parameters for the WebGL shader background */
interface ShaderPalette {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
  /** Animation playback speed multiplier (lower = slower drift) */
  speed: number;
}

const BLOCK_COLORS:    string[]                                         = ['#4f6ef7', '#e03030', '#2eb67d', '#f0a500', '#a259ff', '#ff6b35'];

// Lighter highlight paired with each block color — used for radial/linear gradients on arcs and chips
const BLOCK_COLOR_HIGHLIGHTS: Record<string, string> = {
  '#4f6ef7': '#8ba4ff',
  '#e03030': '#ff6464',
  '#2eb67d': '#5adba6',
  '#f0a500': '#ffc84a',
  '#a259ff': '#c98aff',
  '#ff6b35': '#ff9468',
  '#888':    '#aaaaaa',
};

// -- Skin-specific block color palettes ------------------
// Softer, desaturated colors that harmonize with each glass skin's shader
const BLOCK_COLORS_ARCTIC: string[]  = ['#6a9db8', '#b88a9e', '#7eb89c', '#c4b078', '#9a8ab8', '#b89a7a'];
const BLOCK_COLORS_GLACIER: string[] = ['#5a8fc0', '#c07878', '#68b898', '#c0a858', '#8878c0', '#c09068'];
const BLOCK_COLORS_TEAL: string[]    = ['#48a8b8', '#b86860', '#60b888', '#b8a048', '#9060b8', '#b88858'];

const BLOCK_COLOR_HIGHLIGHTS_ARCTIC: Record<string, string> = {
  '#6a9db8': '#9ac0d0', '#b88a9e': '#d0a8b8', '#7eb89c': '#a8d0c0',
  '#c4b078': '#d8c8a0', '#9a8ab8': '#b8a8d0', '#b89a7a': '#d0b8a0',
};
const BLOCK_COLOR_HIGHLIGHTS_GLACIER: Record<string, string> = {
  '#5a8fc0': '#8ab8e0', '#c07878': '#e0a0a0', '#68b898': '#98d8c0',
  '#c0a858': '#e0c880', '#8878c0': '#b0a0e0', '#c09068': '#e0b898',
};
const BLOCK_COLOR_HIGHLIGHTS_TEAL: Record<string, string> = {
  '#48a8b8': '#78c8d8', '#b86860': '#d89890', '#60b888': '#90d8b0',
  '#b8a048': '#d8c078', '#9060b8': '#b890d8', '#b88858': '#d8b088',
};

const BLOCK_PALETTES: Record<SkinId, string[]> = {
  default: BLOCK_COLORS,
  arctic: BLOCK_COLORS_ARCTIC,
  glacier: BLOCK_COLORS_GLACIER,
  teal: BLOCK_COLORS_TEAL,
};

const BLOCK_HIGHLIGHT_MAPS: Record<SkinId, Record<string, string>> = {
  default: BLOCK_COLOR_HIGHLIGHTS,
  arctic: { ...BLOCK_COLOR_HIGHLIGHTS, ...BLOCK_COLOR_HIGHLIGHTS_ARCTIC },
  glacier: { ...BLOCK_COLOR_HIGHLIGHTS, ...BLOCK_COLOR_HIGHLIGHTS_GLACIER },
  teal: { ...BLOCK_COLOR_HIGHLIGHTS, ...BLOCK_COLOR_HIGHLIGHTS_TEAL },
};

// -- Shader palette presets ------------------------------
// Near-white with whispers of ice blue — closest to iOS frosted aesthetic
const PALETTE_ARCTIC: ShaderPalette = {
  a: [0.82, 0.88, 0.92], b: [0.12, 0.08, 0.08],
  c: [0.50, 0.40, 0.30], d: [0.00, 0.20, 0.45],
  speed: 0.08,
};
// Sky-blue midtones with white crests — more saturated than arctic
const PALETTE_GLACIER: ShaderPalette = {
  a: [0.65, 0.78, 0.85], b: [0.20, 0.15, 0.10],
  c: [0.50, 0.40, 0.35], d: [0.00, 0.25, 0.50],
  speed: 0.08,
};
// Warm aqua/teal shifting into mint-white zones
const PALETTE_TEAL: ShaderPalette = {
  a: [0.62, 0.82, 0.82], b: [0.18, 0.12, 0.14],
  c: [0.45, 0.50, 0.40], d: [0.10, 0.35, 0.55],
  speed: 0.08,
};

// -- Skin registry ---------------------------------------
// Palette stored separately so activateSkin can conditionally init shader based on user pref
const SKIN_PALETTES: Partial<Record<SkinId, ShaderPalette>> = {
  arctic:  PALETTE_ARCTIC,
  glacier: PALETTE_GLACIER,
  teal:    PALETTE_TEAL,
};

const SKINS: Record<SkinId, Skin> = {
  default:   { id: 'default',  label: 'Default', init: () => {}, destroy: () => {} },
  'arctic':  { id: 'arctic',   label: 'Arctic',  init: () => {}, destroy: destroyShaderBackground, glassVariant: true },
  'glacier': { id: 'glacier',  label: 'Glacier', init: () => {}, destroy: destroyShaderBackground, glassVariant: true },
  'teal':    { id: 'teal',     label: 'Teal',    init: () => {}, destroy: destroyShaderBackground, glassVariant: true },
};

function getCurrentSkin(): SkinId {
  const stored = localStorage.getItem('skin');
  if (stored && stored in SKINS) return stored as SkinId;
  return 'default';
}

function getBlockColors(skin: SkinId = getCurrentSkin()): string[] {
  return BLOCK_PALETTES[skin];
}

function getBlockHighlights(skin: SkinId = getCurrentSkin()): Record<string, string> {
  return BLOCK_HIGHLIGHT_MAPS[skin];
}

function getBlockPaletteSize(): number {
  return BLOCK_PALETTES.default.length;
}

function isValidBlockPaletteSlot(slot: number | undefined): slot is number {
  return slot != null && Number.isInteger(slot) && slot >= 0 && slot < getBlockPaletteSize();
}

function normalizeHexColor(color: string): string {
  return color.trim().toLowerCase();
}

function hexToRgb(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(normalizeHexColor(color));
  if (!match) return null;
  const hex = match[1];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function inferBlockPaletteSlotFromColor(color?: string): number {
  if (!color) return 0;
  const normalized = normalizeHexColor(color);

  for (let slot = 0; slot < getBlockPaletteSize(); slot++) {
    if (Object.values(BLOCK_PALETTES).some(palette => normalizeHexColor(palette[slot]) === normalized)) {
      return slot;
    }
  }

  const rgb = hexToRgb(normalized);
  if (!rgb) return 0;

  let bestSlot = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let slot = 0; slot < getBlockPaletteSize(); slot++) {
    for (const palette of Object.values(BLOCK_PALETTES)) {
      const candidateRgb = hexToRgb(palette[slot]);
      if (!candidateRgb) continue;
      const distance =
        (rgb[0] - candidateRgb[0]) ** 2 +
        (rgb[1] - candidateRgb[1]) ** 2 +
        (rgb[2] - candidateRgb[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSlot = slot;
      }
    }
  }

  return bestSlot;
}

function getBlockPaletteSlot(block: { paletteSlot?: number; color?: string }): number {
  return isValidBlockPaletteSlot(block.paletteSlot)
    ? block.paletteSlot
    : inferBlockPaletteSlotFromColor(block.color);
}

function getBlockColorBySlot(slot: number, skin: SkinId = getCurrentSkin()): string {
  return getBlockColors(skin)[slot] || getBlockColors(skin)[0];
}

function getBlockHighlightBySlot(slot: number, skin: SkinId = getCurrentSkin()): string {
  const color = getBlockColorBySlot(slot, skin);
  return getBlockHighlights(skin)[color] || color;
}

function getBlockGradientCss(block: { paletteSlot?: number; color?: string }, angle = '135deg'): string {
  const slot = getBlockPaletteSlot(block);
  return `linear-gradient(${angle}, ${getBlockHighlightBySlot(slot)} 0%, ${getBlockColorBySlot(slot)} 100%)`;
}

function getBlockStorageAppearance(block: { paletteSlot?: number; color?: string }): { paletteSlot: number; color: string } {
  const paletteSlot = getBlockPaletteSlot(block);
  return { paletteSlot, color: getBlockColorBySlot(paletteSlot) };
}

function getClockBlockCornerRadius(): number {
  return 6;
}

// Expose block appearance so the React Schedule island paints clock arcs and chips
// from the same skin/palette as the vanilla view. Read fresh each call so a skin
// switch is reflected once activateSkin() notifies the mirror to re-render.
window.calderaAppearance = {
  palette: () => getBlockColors().map((base, slot) => ({ base, highlight: getBlockHighlightBySlot(slot) })),
  slotForBlock: (block) => getBlockPaletteSlot(block),
  gradientCss: (block) => getBlockGradientCss(block),
  cornerRadius: () => getClockBlockCornerRadius(),
};

// Schedule block write operations exposed via window.calderaSchedule below. They run the
// shared block domain logic (palette slots, recurring conversion, scope handling) and persist
// through saveCalendarData → notify so a React edit repaints the mirror. React always passes an
// explicit ampm, so there is no clock meridian to track here.
async function saveTimeBlock(key: string, { startMin, endMin, label }: { startMin: number; endMin: number; label: string }, recurrence: string, ampm: AmPm): Promise<void> {
  pushCalendarSnapshot();
  if (recurrence === 'none') {
    const day = getOrInitDayData(key);
    const paletteSlot = day.timeBlocks.length % getBlockPaletteSize();
    day.timeBlocks.push({
      id: generateCalendarEntryId(),
      startMin,
      endMin,
      label,
      ...getBlockStorageAppearance({ paletteSlot }),
      ampm,
      completed: false,
      subtasks: [],
    });
  } else {
    if (!calData._recurring) calData._recurring = [];
    const paletteSlot = calData._recurring.length % getBlockPaletteSize();
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    calData._recurring.push({
      id: generateCalendarEntryId(), startMin, endMin, label, ...getBlockStorageAppearance({ paletteSlot }), ampm,
      recurrence: recurrence as RecurringBlock['recurrence'],
      dayOfWeek: date.getDay(),
      dayOfMonth: d,
      completedDates: [],
      excludedDates: [],
      subtasks: [],
    });
  }
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

async function updateTimeBlock(key: string, blockId: string, label: string, recurrence: string, scope: string, ampm: AmPm): Promise<void> {
  pushCalendarSnapshot();
  const recurring = calData._recurring || [];
  const rIdx = recurring.findIndex(b => b.id === blockId);
  const isRecurring = rIdx !== -1;

  if (isRecurring) {
    const block = recurring[rIdx];
    const appearance = getBlockStorageAppearance(block);
    if (scope === 'today') {
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
      const day = getOrInitDayData(key);
      day.timeBlocks.push({
        id: generateCalendarEntryId(), startMin: block.startMin, endMin: block.endMin,
        label, ...appearance, ampm, completed: false, subtasks: [...(block.subtasks || [])],
      });
    } else {
      block.label = label;
      block.ampm = ampm;
      if (recurrence === 'none') {
        recurring.splice(rIdx, 1);
        const day = getOrInitDayData(key);
        const completed = block.completedDates?.includes(key) || false;
        day.timeBlocks.push({
          id: block.id, startMin: block.startMin, endMin: block.endMin,
          label, ...appearance, ampm, completed, subtasks: [...(block.subtasks || [])],
        });
      } else {
        block.recurrence = recurrence as RecurringBlock['recurrence'];
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        block.dayOfWeek = date.getDay();
        block.dayOfMonth = d;
      }
    }
  } else {
    const block = getDayData(key)?.timeBlocks?.find(b => b.id === blockId);
    if (!block) return;
    const appearance = getBlockStorageAppearance(block);
    block.label = label;
    block.ampm = ampm;
    if (recurrence !== 'none') {
      const day = getDayData(key)!;
      day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
      if (!calData._recurring) calData._recurring = [];
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      calData._recurring.push({
        id: block.id, startMin: block.startMin, endMin: block.endMin,
        label, ...appearance, ampm,
        recurrence: recurrence as RecurringBlock['recurrence'],
        dayOfWeek: date.getDay(),
        dayOfMonth: d,
        completedDates: block.completed ? [key] : [],
        excludedDates: [],
        subtasks: [...(block.subtasks || [])],
      });
    }
  }
  await saveCalendarDataAndRefresh(key, { renderCurrentSchedule: true });
}

async function deleteTimeBlock(key: string, blockId: string, scope?: string): Promise<void> {
  pushCalendarSnapshot();
  const recurring = calData._recurring || [];
  const rIdx = recurring.findIndex(b => b.id === blockId);
  if (rIdx !== -1) {
    if (scope === 'today') {
      const block = recurring[rIdx];
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
    } else {
      recurring.splice(rIdx, 1);
    }
    await saveCalendarDataAndRefresh(key, { renderCurrentSchedule: true });
    return;
  }
  const day = getDayData(key);
  if (!day?.timeBlocks) return;
  day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

// Expose the schedule write operations so the React view edits blocks through the same
// domain logic as the vanilla view (palette slots, recurring conversion, scopes) instead
// of re-implementing it. Each persists via saveCalendarData → notify, updating the mirror.
window.calderaSchedule = {
  createBlock: (key, block, recurrence, ampm) => saveTimeBlock(key, block, recurrence, ampm),
  updateBlock: (key, id, label, recurrence, scope, ampm) => updateTimeBlock(key, id, label, recurrence, scope, ampm),
  deleteBlock: (key, id, scope) => deleteTimeBlock(key, id, scope),
};

// Focused-date bridge: holds the single date shared by all lenses (Month/Week/Day)
// and lets React write it back so the in-memory state stays in sync.
const calderaViewListeners = new Set<() => void>();
function notifyCalendarViewChanged(): void {
  calderaViewListeners.forEach(listener => listener());
}
window.calderaView = {
  scheduleDate: () => scheduleDate,
  setScheduleDate: (key) => {
    scheduleDate = key;
    notifyCalendarViewChanged();
  },
  subscribe(listener) {
    calderaViewListeners.add(listener);
    return () => { calderaViewListeners.delete(listener); };
  },
  notify: notifyCalendarViewChanged,
};

window.calderaPrefs = {
  theme: () => document.body.classList.contains('dark') ? 'dark' : 'light',
  setTheme: (theme) => applyCalendarTheme(theme === 'dark'),
  skin: () => getCurrentSkin(),
  setSkin: (skin) => activateSkin(skin),
  shaderPref: () => getShaderPref(),
  setShaderPref: (pref) => {
    setShaderPref(pref);
    activateSkin(getCurrentSkin());
  },
  shaderHint: () => ({
    lowPower: _shaderDisabledByLowPower,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }),
  subscribe(listener) {
    calderaPrefListeners.add(listener);
    return () => { calderaPrefListeners.delete(listener); };
  },
  notify: notifyCalendarPrefsChanged,
};

function forEachCalendarBlock(data: CalData, visit: (block: TimeBlock | RecurringBlock) => void): void {
  (data._recurring || []).forEach(visit);
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (!value || typeof value !== 'object' || !('events' in value)) continue;
    (value as DayData).timeBlocks?.forEach(visit);
  }
}

function normalizeCalendarBlockAppearance(data: CalData): void {
  forEachCalendarBlock(data, (block) => {
    const paletteSlot = getBlockPaletteSlot(block);
    block.paletteSlot = paletteSlot;
    if (!block.color) block.color = getBlockColorBySlot(paletteSlot);
  });
}

function normalizeCalendarBlockSubtasks(data: CalData): void {
  forEachCalendarBlock(data, (block) => {
    const rawTasks = Array.isArray((block as { subtasks?: unknown }).subtasks)
      ? (block as { subtasks?: unknown[] }).subtasks || []
      : [];
    block.subtasks = rawTasks
      .filter((task): task is { id?: unknown; label?: unknown; completed?: unknown; notes?: unknown } => !!task && typeof task === 'object')
      .map((task) => ({
        id: typeof task.id === 'string' && task.id ? task.id : generateCalendarEntryId(),
        label: typeof task.label === 'string' ? task.label.trim() : '',
        completed: Boolean(task.completed),
        notes: typeof task.notes === 'string' ? task.notes.trim() : '',
      }))
      .filter(task => task.label.length > 0);
  });
}

function syncCalendarBlockColorsToCurrentSkin(): void {
  normalizeCalendarBlockAppearance(calData);
  forEachCalendarBlock(calData, (block) => {
    const paletteSlot = getBlockPaletteSlot(block);
    block.paletteSlot = paletteSlot;
    block.color = getBlockColorBySlot(paletteSlot);
  });
}

function activateSkin(id: SkinId): void {
  const prev = getCurrentSkin();
  if (SKINS[prev]) SKINS[prev].destroy();
  [...document.body.classList]
    .filter(cls => cls.startsWith('skin-'))
    .forEach(cls => document.body.classList.remove(cls));
  document.body.classList.remove('shader-static');
  document.body.classList.add(`skin-${id}`);
  // Frost skins (arctic, glacier, teal) share the glass shader structure and frost
  // component overrides. Their individual body classes drive shader palette selection.
  if (SKINS[id]?.glassVariant) {
    document.body.classList.add('skin-glass', 'skin-frost');
    // Only init shader if preference allows (on, or auto without low-power)
    const palette = SKIN_PALETTES[id];
    if (palette && shouldEnableShader()) {
      document.body.classList.remove('shader-static');
      initShaderBackground(palette);
    } else {
      document.body.classList.add('shader-static');
    }
  }
  localStorage.setItem('skin', id);
  notifyCalendarDataChanged(); // repaint the React mirror with the new skin's palette
  notifyCalendarPrefsChanged();
}

// -- Shader preference & low-power detection ------------
type ShaderPref = 'on' | 'off' | 'auto';
let _shaderDisabledByLowPower = false;
const calderaPrefListeners = new Set<() => void>();

function notifyCalendarPrefsChanged(): void {
  calderaPrefListeners.forEach((listener) => listener());
}

function getShaderPref(): ShaderPref {
  const stored = localStorage.getItem('shaderPref');
  if (stored === 'on' || stored === 'off' || stored === 'auto') return stored;
  return 'auto';
}

function setShaderPref(pref: ShaderPref): void {
  localStorage.setItem('shaderPref', pref);
  notifyCalendarPrefsChanged();
}

function shouldEnableShader(): boolean {
  const pref = getShaderPref();
  if (pref === 'off') return false;
  if (pref === 'on') return true;
  // Auto mode: disable on low power or reduced motion preference
  if (_shaderDisabledByLowPower) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

async function detectLowPowerMode(): Promise<void> {
  // Battery API for low-power detection (not available in all browsers)
  if ('getBattery' in navigator) {
    try {
      type BatteryManager = { charging: boolean; level: number; addEventListener(e: string, fn: () => void): void };
      const battery = await (navigator as Navigator & { getBattery(): Promise<BatteryManager> }).getBattery();
      const checkBattery = () => {
        // Consider low power if: not charging AND battery < 20%
        _shaderDisabledByLowPower = !battery.charging && battery.level < 0.2;
        // If shader is running and we just entered low power mode, destroy it
        if (_shaderDisabledByLowPower && _shaderRAF !== null && getShaderPref() === 'auto') {
          destroyShaderBackground();
        }
        notifyCalendarPrefsChanged();
      };
      checkBattery();
      battery.addEventListener('chargingchange', checkBattery);
      battery.addEventListener('levelchange', checkBattery);
    } catch { /* Battery API not supported or failed */ }
  }
}

// -- WebGL shader background (glass skin) ---------------
let _shaderRAF:           number | null                = null;
let _shaderGL:            WebGLRenderingContext | null = null;
let _shaderProg:          WebGLProgram | null          = null;
let _shaderTime:          number                       = 0;
let _shaderLast:          number | null                = null;
// Module-level variable replacing canvas._shaderResizeHandler (which is not valid on HTMLElement)
let _shaderResizeHandler: (() => void) | null          = null;

function initShaderBackground(palette: ShaderPalette): void {
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
  // Palette coefficients passed as uniforms so each skin can drive different colours
  // without recompiling the shader — u_pa/b/c/d are the cosine-palette a/b/c/d vectors.
  const fs = compileShader(glNN.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec2  u_resolution;
    uniform float u_time;
    uniform float u_speed;
    uniform vec3  u_pa;
    uniform vec3  u_pb;
    uniform vec3  u_pc;
    uniform vec3  u_pd;

    vec3 palette(float t) {
      return u_pa + u_pb * cos(6.28318 * (u_pc * t + u_pd));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      uv.x *= u_resolution.x / u_resolution.y;
      float t = u_time * u_speed;
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

  const uRes   = glNN.getUniformLocation(prog, 'u_resolution');
  const uTime  = glNN.getUniformLocation(prog, 'u_time');
  const uSpeed = glNN.getUniformLocation(prog, 'u_speed');

  // Palette uniforms are constant per-skin — set them once at init time
  glNN.useProgram(prog);
  glNN.uniform1f(uSpeed, palette.speed);
  glNN.uniform3f(glNN.getUniformLocation(prog, 'u_pa'), ...palette.a);
  glNN.uniform3f(glNN.getUniformLocation(prog, 'u_pb'), ...palette.b);
  glNN.uniform3f(glNN.getUniformLocation(prog, 'u_pc'), ...palette.c);
  glNN.uniform3f(glNN.getUniformLocation(prog, 'u_pd'), ...palette.d);

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

// -- Boot -----------------------------------------------
async function initCalendarApp(): Promise<void> {
  applyCalendarTheme(localStorage.getItem('theme') === 'dark');
  await detectLowPowerMode();
  activateSkin(getCurrentSkin());
  const raw = await calBridge.loadData();
  loadWorkspaceFromRaw(raw);
  bindCalendarUIEvents();
}

function applyCalendarTheme(isDarkMode: boolean): void {
  document.body.classList.toggle('dark', isDarkMode);
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  notifyCalendarPrefsChanged();
}

// -- UI bindings ----------------------------------------
function bindCalendarUIEvents(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName);
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey && !inInput) {
      e.preventDefault();
      if (undoStack.length) {
        redoStack.push(JSON.stringify(calData));
        void applyCalendarSnapshot(undoStack.pop()!);
      }
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === 'Z' && !inInput) {
      e.preventDefault();
      if (redoStack.length) {
        undoStack.push(JSON.stringify(calData));
        void applyCalendarSnapshot(redoStack.pop()!);
      }
      return;
    }
  });

  bindGlassButtonLightFollow();
}

// -- Glass: button light-follow effect ------------------
function bindGlassButtonLightFollow(): void {
  const selector = [
    '#win-controls button',
    '.nav-arrow',
    '.month-tab',
    '.view-tab',
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

// -- Start ----------------------------------------------
initCalendarApp();


