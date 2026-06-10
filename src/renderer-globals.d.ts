// Global ambient type declarations for renderer.ts.
// This file has NO imports — keeping it import-free means TypeScript treats it as
// a global ambient declaration file rather than a module. All types declared here
// are visible in renderer.ts without any import statement, so renderer.ts stays a
// plain script file. A script file with no top-level import/export emits no
// CommonJS wrapper (no `Object.defineProperty(exports, ...)`) — which is required
// because renderer.js is loaded via a plain <script> tag, not through Node's
// module system. An `exports` reference in a browser context throws ReferenceError
// and silently kills the entire renderer.

type DateKey = string;
type AmPm = 'AM' | 'PM';
type RecurrenceType = 'daily' | 'weekly' | 'monthly';
type SkinId = 'default' | 'arctic' | 'glacier' | 'teal';
type ViewType = 'calendar' | 'schedule';
type ScheduleViewMode = 'daily' | 'schedule';
type ScheduleTimelineScale = 'day';

interface CalendarEvent {
  id: string;
  image: string | null;
  notes: string;
  /** HH:MM string or empty string */
  time: string;
}

interface DayData {
  events: CalendarEvent[];
  featuredId: string | null;
  timeBlocks: TimeBlock[];
}

interface BlockSubtask {
  id: string;
  label: string;
  completed: boolean;
}

interface TimeBlock {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
  paletteSlot?: number;
  color: string;
  ampm: AmPm;
  completed: boolean;
  subtasks: BlockSubtask[];
}

interface RecurringBlock {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
  paletteSlot?: number;
  color: string;
  ampm: AmPm;
  recurrence: RecurrenceType;
  dayOfWeek: number;
  dayOfMonth: number;
  completedDates: DateKey[];
  excludedDates: DateKey[];
  subtasks: BlockSubtask[];
}

interface CalData {
  _recurring: RecurringBlock[];
  _aiConfig?: unknown;
  [dateKey: string]: DayData | RecurringBlock[] | unknown;
}

interface AiConfig {
  provider: 'claude' | 'ollama' | 'openai';
  apiKey: string;
  mode: 'fetch' | 'websearch';
  ollamaUrl: string;
  ollamaModel: string;
  interests: string;
  sites: string[];
  keywords: string[];
  dateRangeStart: string;
  dateRangeEnd: string;
}

interface AiEvent {
  title: string;
  date: DateKey;
  time: string | null;
  notes: string;
  sourceUrl: string;
}

interface AiImportResult {
  events?: AiEvent[];
  error?: string;
}

interface CalAPI {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: unknown): Promise<void>;
  copyImage(srcPath: string, fileName: string): Promise<string>;
  saveImageBuffer(buf: number[], fileName: string, ext: string): Promise<string>;
  deleteImage(relPath: string): Promise<void>;
  resolveImage(relPath: string): Promise<string>;
  openFileDialog(): Promise<string | null>;
  getPathForFile(file: object): string;
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  aiSaveConfig(config: AiConfig): Promise<void>;
  aiLoadConfig(): Promise<AiConfig | null>;
  aiRunImport(): Promise<AiImportResult>;
  ollamaListModels(): Promise<string[]>;
  openExternal(url: string): void;
}

// Minimal data bridge the vanilla renderer exposes on window so the React island
// can mirror the single in-memory calData source of truth during the incremental
// migration — one object, one persistence path, two reactive consumers.
interface CalderaBridge {
  getData(): CalData;
  save(): Promise<void>;
  subscribe(listener: () => void): () => void;
  notify(): void;
  /** Snapshot calData onto the shared undo stack before a mutation (keeps undo/redo working across the React boundary). */
  pushSnapshot(): void;
}

// Block appearance resolved from the current skin/palette, exposed so the React
// island can paint clock arcs and chips with the exact same colors as the vanilla view.
interface CalderaAppearance {
  /** Current skin's per-slot block colors and their radial-gradient highlights. */
  palette(): { base: string; highlight: string }[];
  slotForBlock(block: { paletteSlot?: number; color?: string }): number;
  gradientCss(block: { paletteSlot?: number; color?: string }): string;
  cornerRadius(): number;
}

// Extend the global Window interface so renderer.ts can access window.calAPI with full type safety
interface Window {
  calAPI: CalAPI;
  calderaBridge: CalderaBridge;
  calderaAppearance: CalderaAppearance;
}
