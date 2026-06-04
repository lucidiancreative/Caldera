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

interface TimeBlockPopupState {
  mode: 'new' | 'edit';
  key: string;
  startMin: number;
  endMin: number;
  id?: string;
  _cleanup?: () => void;
}

interface TimelineResizeState {
  key: string;
  kind: 'leading' | 'between' | 'trailing';
  leftBlockId?: string;
  rightBlockId?: string;
  hourWidth: number;
}

interface TimelineSegment {
  block: TimeBlock | RecurringBlock;
  recurring: boolean;
  completed: boolean;
  start: number;
  end: number;
}

interface ScheduleBlockSelection {
  key: string;
  blockId: string;
}

type BlockOrPartial =
  | (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean; recurrence?: string; dayOfWeek?: number; dayOfMonth?: number; completedDates?: string[]; excludedDates?: string[] })
  | { startMin: number; endMin: number; id?: undefined; label?: undefined; color?: string; paletteSlot?: number; ampm?: AmPm };

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

function applyBlockGradientStyle(el: HTMLElement, block: { paletteSlot?: number; color?: string }, angle = '135deg'): void {
  el.style.background = getBlockGradientCss(block, angle);
}

function getBlockStorageAppearance(block: { paletteSlot?: number; color?: string }): { paletteSlot: number; color: string } {
  const paletteSlot = getBlockPaletteSlot(block);
  return { paletteSlot, color: getBlockColorBySlot(paletteSlot) };
}

function getBlockGradientId(slot: number): string {
  return `block-grad-slot-${slot}`;
}

function getClockBlockCornerRadius(): number {
  return 6;
}

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
      .filter((task): task is { id?: unknown; label?: unknown; completed?: unknown } => !!task && typeof task === 'object')
      .map((task) => ({
        id: typeof task.id === 'string' && task.id ? task.id : generateCalendarEntryId(),
        label: typeof task.label === 'string' ? task.label.trim() : '',
        completed: Boolean(task.completed),
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
  _skinSwitchPending = true;
  localStorage.setItem('skin', id);
}

// -- Skin switch animation flag -------------------------
let _skinSwitchPending = false;

// -- Shader preference & low-power detection ------------
type ShaderPref = 'on' | 'off' | 'auto';
let _shaderDisabledByLowPower = false;

function getShaderPref(): ShaderPref {
  const stored = localStorage.getItem('shaderPref');
  if (stored === 'on' || stored === 'off' || stored === 'auto') return stored;
  return 'auto';
}

function setShaderPref(pref: ShaderPref): void {
  localStorage.setItem('shaderPref', pref);
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
  calData = migrateCalendarDataFormat(raw);
  renderMonthStrip();
  renderCalendarGrid();
  bindCalendarUIEvents();
}

function applyCalendarTheme(isDarkMode: boolean): void {
  document.body.classList.toggle('dark', isDarkMode);
  localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
}

// -- UI bindings ----------------------------------------
function bindCalendarUIEvents(): void {
  // Remove the glass-skin .is-entering class once the entrance animation completes so the
  // animated opacity/transform don't persist on the compositor — see renderCalendarGrid
  // for a full explanation of why this matters.
  qId('calendar-grid').addEventListener('animationend', (e: AnimationEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.animationName === 'glass-cell-enter') el.classList.remove('is-entering');
    if (e.animationName === 'skin-fade-in') el.classList.remove('skin-fade-in');
  });

  qId('btn-min').addEventListener('click', () => calBridge.winMinimize());
  qId('btn-max').addEventListener('click', () => calBridge.winMaximize());
  qId('btn-close').addEventListener('click', () => calBridge.winClose());

  qId('btn-settings').addEventListener('click', openSettingsModal);

  qId('btn-ai').addEventListener('click', openAiSettingsModal);
  qId('ai-modal-close').addEventListener('click', closeAiSettingsModal);
  qId('ai-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('ai-overlay')) closeAiSettingsModal();
  });
  qId<HTMLInputElement>('ai-provider-claude').addEventListener('change', () => syncAiProviderPanel('claude'));
  qId<HTMLInputElement>('ai-provider-openai').addEventListener('change', () => syncAiProviderPanel('openai'));
  qId<HTMLInputElement>('ai-provider-ollama').addEventListener('change', () => { syncAiProviderPanel('ollama'); refreshOllamaModels(); });
  qId('ai-refresh-models').addEventListener('click', refreshOllamaModels);
  qId('ai-model-trigger').addEventListener('click', toggleModelDropdown);
  document.addEventListener('click', (e: MouseEvent) => {
    const dropdown = qId('ai-model-dropdown');
    if (!dropdown.contains(e.target as Node)) closeModelDropdown();
  });
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
  qId('ai-keyword-add-btn').addEventListener('click', () => {
    const input = qId<HTMLInputElement>('ai-keyword-input');
    const kw    = input.value.trim();
    if (!kw) return;
    const current = getAiKeywordsFromList();
    if (!current.includes(kw)) renderAiKeywordList([...current, kw]);
    input.value = '';
  });
  qId('ai-keyword-input').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') qId('ai-keyword-add-btn').click();
  });
  qId('ai-save-btn').addEventListener('click', saveAiSettings);
  qId('ai-run-btn').addEventListener('click', runAiImport);

  qId('ai-date-start-btn').addEventListener('click', (e: MouseEvent) => {
    openAiDatePicker('ai-date-start', e.currentTarget as HTMLElement);
  });
  qId('ai-date-end-btn').addEventListener('click', (e: MouseEvent) => {
    openAiDatePicker('ai-date-end', e.currentTarget as HTMLElement);
  });
  qId('ai-dp-prev').addEventListener('click', aiDatePickerPrev);
  qId('ai-dp-next').addEventListener('click', aiDatePickerNext);
  qId('ai-dp-today').addEventListener('click', aiDatePickerToday);
  qId('ai-dp-clear').addEventListener('click', aiDatePickerClear);
  document.addEventListener('click', (e: MouseEvent) => {
    const picker = qId('ai-datepicker');
    if (picker.classList.contains('hidden')) return;
    const target = e.target as HTMLElement;
    if (!picker.contains(target) && !target.closest('.ai-date-btn')) {
      closeAiDatePicker();
    }
  });

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

  qId('settings-modal-close').addEventListener('click', closeSettingsModal);
  qId('settings-overlay').addEventListener('click', (e: MouseEvent) => {
    if (e.target === qId('settings-overlay')) closeSettingsModal();
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
        scheduleViewMode = 'daily';
      }
      switchCalendarView(btn.dataset.view as ViewType);
    });
  });
  qId('sched-prev-day').addEventListener('click', () => stepScheduleDay(-1));
  qId('sched-next-day').addEventListener('click', () => stepScheduleDay(1));
  qId('schedule-mode-daily').addEventListener('click', () => setScheduleViewMode('daily'));
  qId('schedule-mode-timeline').addEventListener('click', () => setScheduleViewMode('schedule'));
  qId('schedule-subtask-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!scheduleDate || !selectedScheduleBlock || selectedScheduleBlock.key !== scheduleDate) return;
    const input = qId<HTMLInputElement>('schedule-subtask-input');
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    void addBlockSubtask(scheduleDate, selectedScheduleBlock.blockId, value);
  });

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
      if (!qId('settings-overlay').classList.contains('hidden')) { closeSettingsModal(); return; }
      if (!qId('lightbox-overlay').classList.contains('hidden')) closeLightbox();
      else if (modalDate) closeDayDetailModal();
      else if (rescheduleBlock) cancelReschedule();
      return;
    }

    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName);

    // Backspace over a hovered clock block ? delete it
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
  bindThemeToggleEvents();
  bindShaderToggleEvents();
}

// -- Skin picker -----------------------------------------
function openSettingsModal(): void {
  renderThemeToggle();
  renderSkinGrid();
  renderShaderToggle();
  qId('settings-overlay').classList.remove('hidden');
}

function closeSettingsModal(): void {
  qId('settings-overlay').classList.add('hidden');
}

// -- AI Import: Settings Modal -------------------------

async function openAiSettingsModal(): Promise<void> {
  const cfg = await calBridge.aiLoadConfig();
  const savedModel = cfg?.ollamaModel || '';
  if (cfg) {
    qId<HTMLInputElement>('ai-apikey-input').value    = cfg.apiKey      || '';
    qId<HTMLInputElement>('ai-interests-input').value = cfg.interests   || '';
    qId<HTMLInputElement>('ai-ollama-url').value      = cfg.ollamaUrl   || 'http://localhost:11434';
    setAiDateValue('ai-date-start', cfg.dateRangeStart || '');
    setAiDateValue('ai-date-end', cfg.dateRangeEnd || '');
    renderAiUrlList(cfg.sites || []);
    renderAiKeywordList(cfg.keywords || []);
    const providerRadio = document.querySelector(`input[name="ai-provider"][value="${cfg.provider || 'claude'}"]`) as HTMLInputElement | null;
    if (providerRadio) { providerRadio.checked = true; syncAiProviderPanel(cfg.provider || 'claude'); }
    const modeRadio = document.querySelector(`input[name="ai-mode"][value="${cfg.mode || 'fetch'}"]`) as HTMLInputElement | null;
    if (modeRadio) { modeRadio.checked = true; syncAiModePanel(cfg.mode || 'fetch'); }
    if (cfg.provider === 'ollama') {
      await refreshOllamaModels();
      if (savedModel) selectModel(savedModel);
    }
  } else {
    qId<HTMLInputElement>('ai-provider-claude').checked = true;
    qId<HTMLInputElement>('ai-mode-fetch').checked      = true;
    qId<HTMLInputElement>('ai-ollama-url').value        = 'http://localhost:11434';
    setAiDateValue('ai-date-start', '');
    setAiDateValue('ai-date-end', '');
    syncAiProviderPanel('claude');
    syncAiModePanel('fetch');
    renderAiUrlList([]);
    renderAiKeywordList([]);
  }
  setAiStatus('', '');
  qId('ai-overlay').classList.remove('hidden');
}

function closeAiSettingsModal(): void {
  qId('ai-overlay').classList.add('hidden');
}

function syncAiProviderPanel(provider: string): void {
  const isOllama = provider === 'ollama';
  const needsApiKey = provider === 'claude' || provider === 'openai';
  qId('ai-apikey-panel').classList.toggle('hidden', !needsApiKey);
  qId('ai-ollama-panel').classList.toggle('hidden', !isOllama);
  // Update API key label and placeholder based on provider
  const label = qId('ai-apikey-label');
  const input = qId<HTMLInputElement>('ai-apikey-input');
  if (provider === 'claude') {
    label.textContent = 'Anthropic API Key';
    input.placeholder = 'sk-ant-api03-…';
  } else if (provider === 'openai') {
    label.textContent = 'OpenAI API Key';
    input.placeholder = 'sk-...';
  }
  // Only Claude supports web search mode — hide mode selector for others
  const showModeSelector = provider === 'claude';
  qId('ai-mode-group').classList.toggle('hidden', !showModeSelector);
  if (!showModeSelector) {
    qId<HTMLInputElement>('ai-mode-fetch').checked = true;
    syncAiModePanel('fetch');
  }
}

function syncAiModePanel(mode: string): void {
  qId('ai-fetch-panel').classList.toggle('hidden', mode !== 'fetch');
  qId('ai-websearch-panel').classList.toggle('hidden', mode !== 'websearch');
}

function toggleModelDropdown(): void {
  const trigger = qId('ai-model-trigger');
  const list = qId('ai-model-list');
  const isOpen = !list.classList.contains('hidden');
  if (isOpen) {
    closeModelDropdown();
  } else {
    trigger.classList.add('open');
    list.classList.remove('hidden');
  }
}

function closeModelDropdown(): void {
  qId('ai-model-trigger').classList.remove('open');
  qId('ai-model-list').classList.add('hidden');
}

function selectModel(model: string): void {
  qId<HTMLInputElement>('ai-ollama-model').value = model;
  const valueEl = qId('ai-model-value');
  valueEl.textContent = model || 'Select a model...';
  valueEl.classList.toggle('placeholder', !model);
  qId('ai-model-list').querySelectorAll('.ai-model-item').forEach((item) => {
    item.classList.toggle('selected', item.getAttribute('data-model') === model);
  });
  closeModelDropdown();
}

async function refreshOllamaModels(): Promise<void> {
  const list = qId('ai-model-list');
  const btn = qId<HTMLButtonElement>('ai-refresh-models');
  const trigger = qId<HTMLButtonElement>('ai-model-trigger');
  const currentValue = qId<HTMLInputElement>('ai-ollama-model').value;

  btn.classList.add('loading');
  btn.disabled = true;
  trigger.disabled = true;

  try {
    const models = await calBridge.ollamaListModels();
    list.innerHTML = '';
    if (models.length === 0) {
      const item = document.createElement('div');
      item.className = 'ai-model-item no-models';
      item.textContent = 'No models found';
      list.appendChild(item);
    } else {
      models.forEach((name) => {
        const item = document.createElement('div');
        item.className = 'ai-model-item';
        if (name === currentValue) item.classList.add('selected');
        item.setAttribute('data-model', name);
        item.textContent = name;
        item.addEventListener('click', () => selectModel(name));
        list.appendChild(item);
      });
      if (!currentValue && models.length > 0) selectModel(models[0]);
    }
  } catch {
    list.innerHTML = '<div class="ai-model-item no-models">Error fetching models</div>';
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
    trigger.disabled = false;
  }
}

// -- AI Date Picker ------------------------------------

let aiDatePickerTarget: string | null = null;
let aiDatePickerYear = new Date().getFullYear();
let aiDatePickerMonth = new Date().getMonth();

function setAiDateValue(inputId: string, value: string): void {
  qId<HTMLInputElement>(inputId).value = value;
  const btn = qId<HTMLButtonElement>(inputId + '-btn');
  const textSpan = btn.querySelector('.ai-date-btn-text') as HTMLSpanElement;
  if (value) {
    textSpan.textContent = formatDisplayDate(value);
    btn.classList.add('has-value');
  } else {
    textSpan.textContent = inputId === 'ai-date-start' ? 'Start date' : 'End date';
    btn.classList.remove('has-value');
  }
}

function openAiDatePicker(targetId: string, anchorBtn: HTMLElement): void {
  aiDatePickerTarget = targetId;
  const currentVal = qId<HTMLInputElement>(targetId).value;
  if (currentVal && /^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
    const [y, m] = currentVal.split('-').map(Number);
    aiDatePickerYear = y;
    aiDatePickerMonth = m - 1;
  } else {
    const now = new Date();
    aiDatePickerYear = now.getFullYear();
    aiDatePickerMonth = now.getMonth();
  }
  renderAiDatePicker();
  const picker = qId('ai-datepicker');
  picker.classList.remove('hidden');
  const rect = anchorBtn.getBoundingClientRect();
  const pickerHeight = 280;
  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove = spaceBelow < pickerHeight && rect.top > pickerHeight;
  picker.style.left = rect.left + 'px';
  picker.style.top = showAbove ? (rect.top - pickerHeight - 4) + 'px' : (rect.bottom + 4) + 'px';
}

function closeAiDatePicker(): void {
  qId('ai-datepicker').classList.add('hidden');
  aiDatePickerTarget = null;
}

function renderAiDatePicker(): void {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  qId('ai-dp-month-year').textContent = `${monthNames[aiDatePickerMonth]} ${aiDatePickerYear}`;

  const daysContainer = qId('ai-dp-days');
  daysContainer.innerHTML = '';

  const firstDay = new Date(aiDatePickerYear, aiDatePickerMonth, 1).getDay();
  const daysInMonth = new Date(aiDatePickerYear, aiDatePickerMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(aiDatePickerYear, aiDatePickerMonth, 0).getDate();

  const today = getTodayKey();
  const selectedVal = aiDatePickerTarget ? qId<HTMLInputElement>(aiDatePickerTarget).value : '';

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-dp-day other-month';
    btn.textContent = String(day);
    const m = aiDatePickerMonth === 0 ? 12 : aiDatePickerMonth;
    const y = aiDatePickerMonth === 0 ? aiDatePickerYear - 1 : aiDatePickerYear;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    btn.addEventListener('click', () => selectAiDate(dateStr));
    daysContainer.appendChild(btn);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-dp-day';
    btn.textContent = String(day);
    const dateStr = `${aiDatePickerYear}-${String(aiDatePickerMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateStr === today) btn.classList.add('today');
    if (dateStr === selectedVal) btn.classList.add('selected');
    btn.addEventListener('click', () => selectAiDate(dateStr));
    daysContainer.appendChild(btn);
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let day = 1; day <= remaining; day++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-dp-day other-month';
    btn.textContent = String(day);
    const m = aiDatePickerMonth === 11 ? 1 : aiDatePickerMonth + 2;
    const y = aiDatePickerMonth === 11 ? aiDatePickerYear + 1 : aiDatePickerYear;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    btn.addEventListener('click', () => selectAiDate(dateStr));
    daysContainer.appendChild(btn);
  }
}

function selectAiDate(dateStr: string): void {
  if (aiDatePickerTarget) {
    setAiDateValue(aiDatePickerTarget, dateStr);
  }
  closeAiDatePicker();
}

function aiDatePickerPrev(): void {
  aiDatePickerMonth--;
  if (aiDatePickerMonth < 0) {
    aiDatePickerMonth = 11;
    aiDatePickerYear--;
  }
  renderAiDatePicker();
}

function aiDatePickerNext(): void {
  aiDatePickerMonth++;
  if (aiDatePickerMonth > 11) {
    aiDatePickerMonth = 0;
    aiDatePickerYear++;
  }
  renderAiDatePicker();
}

function aiDatePickerToday(): void {
  selectAiDate(getTodayKey());
}

function aiDatePickerClear(): void {
  if (aiDatePickerTarget) {
    setAiDateValue(aiDatePickerTarget, '');
  }
  closeAiDatePicker();
}

function renderAiUrlList(sites: string[]): void {
  const list = qId('ai-url-list');
  renderList(list, sites, (url, i) => {
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
    return row;
  });
}

function getAiSitesFromList(): string[] {
  return Array.from(document.querySelectorAll('#ai-url-list .ai-url-row span')).map(s => s.textContent || '');
}

function renderAiKeywordList(keywords: string[]): void {
  const list = qId('ai-keyword-list');
  renderList(list, keywords, (kw, i) => {
    const row  = document.createElement('div');
    row.className = 'ai-url-row';
    const span = document.createElement('span');
    span.textContent = kw;
    const btn  = document.createElement('button');
    btn.className   = 'ai-url-remove';
    btn.textContent = '\u2715';
    btn.title       = 'Remove';
    btn.addEventListener('click', () => {
      const current = getAiKeywordsFromList();
      current.splice(i, 1);
      renderAiKeywordList(current);
    });
    row.append(span, btn);
    return row;
  });
}

function getAiKeywordsFromList(): string[] {
  return Array.from(document.querySelectorAll('#ai-keyword-list .ai-url-row span')).map(s => s.textContent || '');
}

function getAiConfig(): AiConfig {
  const provider       = (document.querySelector('input[name="ai-provider"]:checked') as HTMLInputElement | null)?.value || 'claude';
  const apiKey         = qId<HTMLInputElement>('ai-apikey-input').value.trim();
  const ollamaUrl      = qId<HTMLInputElement>('ai-ollama-url').value.trim();
  const ollamaModel    = qId<HTMLInputElement>('ai-ollama-model').value;
  const mode           = (document.querySelector('input[name="ai-mode"]:checked') as HTMLInputElement | null)?.value || 'fetch';
  const interests      = qId<HTMLInputElement>('ai-interests-input').value.trim();
  const sites          = getAiSitesFromList();
  const keywords       = getAiKeywordsFromList();
  const dateRangeStart = qId<HTMLInputElement>('ai-date-start').value.trim();
  const dateRangeEnd   = qId<HTMLInputElement>('ai-date-end').value.trim();
  return { provider: provider as AiConfig['provider'], apiKey, ollamaUrl, ollamaModel, mode: mode as AiConfig['mode'], interests, sites, keywords, dateRangeStart, dateRangeEnd };
}

function setAiStatus(msg: string, type: string): void {
  const el = qId('ai-status');
  el.textContent = msg;
  el.className   = 'ai-status' + (type ? ` ${type}` : '') + (msg ? '' : ' hidden');
}

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch { return false; }
}

async function saveAiSettings(): Promise<void> {
  const cfg = getAiConfig();
  if (cfg.provider === 'claude' && !cfg.apiKey) {
    setAiStatus('Please enter your Anthropic API key.', 'error'); return;
  }
  if (cfg.provider === 'openai' && !cfg.apiKey) {
    setAiStatus('Please enter your OpenAI API key.', 'error'); return;
  }
  if (cfg.provider === 'ollama' && !cfg.ollamaUrl) {
    setAiStatus('Please enter the Ollama endpoint URL.', 'error'); return;
  }
  // Warn if using unencrypted HTTP for non-localhost Ollama endpoint
  if (cfg.provider === 'ollama' && cfg.ollamaUrl.startsWith('http://') && !isLocalhostUrl(cfg.ollamaUrl)) {
    setAiStatus('Warning: Using unencrypted HTTP for a remote Ollama server. Consider using HTTPS.', 'warning');
    await calBridge.aiSaveConfig(cfg);
    return;
  }
  await calBridge.aiSaveConfig(cfg);
  setAiStatus('Settings saved.', '');
}

async function runAiImport(): Promise<void> {
  const cfg = getAiConfig();
  if (cfg.provider === 'claude' && !cfg.apiKey) {
    setAiStatus('Please enter and save your API key first.', 'error'); return;
  }
  if (cfg.provider === 'openai' && !cfg.apiKey) {
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

// -- AI Import: Review Modal ---------------------------

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
  renderList(list, events, (ev, i) => {
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
    return row;
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
  await saveCalendarDataAndRefresh(rows[0] ? aiPendingEvents[parseInt(rows[0].dataset.idx!)]?.date || getTodayKey() : getTodayKey(), {
    renderCalendarGrid: true,
    renderMonth: true,
  });
  closeAiReviewModal();
}

function renderThemeToggle(): void {
  const isDark = document.body.classList.contains('dark');
  (document.querySelectorAll('.theme-opt') as NodeListOf<HTMLButtonElement>).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === (isDark ? 'dark' : 'light'));
  });
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
      renderShaderToggle();
      // Re-render grid so cell animation delays apply/remove correctly
      renderCalendarGrid();
    });
    grid.appendChild(card);
  });
}

function renderShaderToggle(): void {
  const section = qId('shader-toggle-section');
  const current = getCurrentSkin();
  const isGlassSkin = SKINS[current]?.glassVariant ?? false;

  // Only show shader toggle for glass skins
  section.style.display = isGlassSkin ? '' : 'none';
  if (!isGlassSkin) return;

  const pref = getShaderPref();
  (document.querySelectorAll('.shader-opt') as NodeListOf<HTMLButtonElement>).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pref === pref);
  });

  // Update hint text based on current state
  const hint = qId('shader-toggle-hint');
  if (pref === 'auto') {
    if (_shaderDisabledByLowPower) {
      hint.textContent = 'Disabled (low battery detected)';
    } else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      hint.textContent = 'Disabled (reduced motion preference)';
    } else {
      hint.textContent = 'Adjusts based on battery and system preferences';
    }
  } else if (pref === 'off') {
    hint.textContent = 'Static background for better performance';
  } else {
    hint.textContent = 'Animated shader always enabled';
  }
}

function bindThemeToggleEvents(): void {
  (document.querySelectorAll('.theme-opt') as NodeListOf<HTMLButtonElement>).forEach(btn => {
    btn.addEventListener('click', () => {
      const isDark = btn.dataset.theme === 'dark';
      applyCalendarTheme(isDark);
      renderThemeToggle();
    });
  });
}

function bindShaderToggleEvents(): void {
  (document.querySelectorAll('.shader-opt') as NodeListOf<HTMLButtonElement>).forEach(btn => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.pref as ShaderPref;
      setShaderPref(pref);
      // Re-activate current skin to apply shader change
      activateSkin(getCurrentSkin());
      renderShaderToggle();
      renderCalendarGrid();
    });
  });
}

// -- Glass: button light-follow effect ------------------
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

// -- Day-change watcher ---------------------------------
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

// -- View switching --------------------------------------
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

// -- Start ----------------------------------------------
initCalendarApp();
startDayChangeWatcher();



