// ── Primitive aliases ────────────────────────────────────────────────────────

/** Calendar date key in YYYY-MM-DD format */
export type DateKey = string;

export type AmPm = 'AM' | 'PM';
export type RecurrenceType = 'daily' | 'weekly' | 'monthly';
export type SkinId = 'default' | 'glass' | 'arctic' | 'glacier' | 'teal';
export type ViewType = 'calendar' | 'schedule';

// ── Calendar data shapes ─────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  image: string | null;
  notes: string;
  /** HH:MM string or empty string */
  time: string;
}

export interface DayData {
  events: CalendarEvent[];
  featuredId: string | null;
  timeBlocks: TimeBlock[];
}

export interface TimeBlock {
  id: string;
  /** Minutes from midnight on a 12-hour face (0–719) */
  startMin: number;
  endMin: number;
  label: string;
  /** Hex colour string */
  color: string;
  ampm: AmPm;
  completed: boolean;
}

export interface RecurringBlock {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
  color: string;
  ampm: AmPm;
  recurrence: RecurrenceType;
  /** 0–6, Sunday = 0 */
  dayOfWeek: number;
  /** 1–31 */
  dayOfMonth: number;
  completedDates: DateKey[];
  /** Days where the recurring block is skipped or overridden */
  excludedDates: DateKey[];
}

/**
 * Top-level on-disk data shape. YYYY-MM-DD keys map to DayData.
 * The special keys `_recurring` and `_aiConfig` are also present.
 * The index signature is intentionally wide — callers narrow via getDayData().
 */
export interface CalData {
  _recurring: RecurringBlock[];
  /** Owned by ai-import; opaque to the renderer */
  _aiConfig?: unknown;
  [dateKey: string]: DayData | RecurringBlock[] | unknown;
}

// ── AI types (shared between ai-import.ts and renderer.ts) ──────────────────

export interface AiConfig {
  provider: 'claude' | 'ollama';
  apiKey: string;
  mode: 'fetch' | 'websearch';
  ollamaUrl: string;
  ollamaModel: string;
  interests: string;
  sites: string[];
}

export interface AiEvent {
  title: string;
  date: DateKey;
  time: string | null;
  notes: string;
  sourceUrl: string;
}

export interface AiImportResult {
  events?: AiEvent[];
  error?: string;
}

// ── Bridge surface (contextBridge → window.calAPI) ───────────────────────────

/**
 * The typed API surface exposed from preload.ts via contextBridge.
 * Declared here (not in preload.ts) so renderer.ts can import it as a
 * type-only import without creating a cross-context runtime dependency.
 */
export interface CalAPI {
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
  openExternal(url: string): void;
}
