// ── Primitive aliases ────────────────────────────────────────────────────────

/** Calendar date key in YYYY-MM-DD format */
export type DateKey = string;

export type AmPm = 'AM' | 'PM';
export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'weekends';
export type SkinId = 'default' | 'arctic' | 'glacier' | 'teal';
export type ScheduleViewMode = 'daily' | 'schedule';
export type ScheduleTimelineScale = 'day';

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

export interface BlockSubtask {
  id: string;
  label: string;
  completed: boolean;
  notes: string;
}

/** A quick-add task in the per-calendar inbox — no time yet; gets scheduled by dragging onto the timeline. */
export interface InboxTask {
  id: string;
  label: string;
  completed: boolean;
  /** Flagged as a deadline in the sidebar; rides along to the block it schedules into. */
  deadline?: boolean;
}

export interface TimeBlock {
  id: string;
  /** Minutes from midnight on a 12-hour face (0–719) */
  startMin: number;
  endMin: number;
  label: string;
  /** Shared palette slot so blocks can re-theme consistently across skins */
  paletteSlot?: number;
  /** Hex colour string */
  color: string;
  ampm: AmPm;
  completed: boolean;
  /** Drawn with a red outline across all schedule views to grab attention. */
  deadline?: boolean;
  subtasks: BlockSubtask[];
}

export interface RecurringBlock {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
  /** Shared palette slot so recurring blocks can re-theme consistently across skins */
  paletteSlot?: number;
  color: string;
  ampm: AmPm;
  recurrence: RecurrenceType;
  /** 0–6, Sunday = 0 */
  dayOfWeek: number;
  /** 1–31 */
  dayOfMonth: number;
  /** Drawn with a red outline across all schedule views to grab attention. */
  deadline?: boolean;
  completedDates: DateKey[];
  /** Days where the recurring block is skipped or overridden */
  excludedDates: DateKey[];
  subtasks: BlockSubtask[];
}

// ── Money lens (budgets) ─────────────────────────────────────────────────────

/** Which budget section a row group is; sets its value columns + default accent. `custom`
 *  is a blank, user-added panel (single Amount column). */
export type BudgetSectionKind = 'income' | 'assets' | 'liabilities' | 'bills' | 'funds' | 'goals' | 'custom';

/**
 * A budget line item. `values` is keyed by the section kind's column ids (e.g. `monthly`).
 * `children` nest purely for organization — a header row simply carries no values and
 * contributes 0 to totals.
 */
export interface BudgetItem {
  id: string;
  label: string;
  values: Record<string, number>;
  /** Goals only: a target date (free text like `2027` or a `1-Sep` style label). */
  date?: string;
  children?: BudgetItem[];
}

/** A section's placement on the Money dashboard canvas, in 12-col grid units (height is
 *  derived from content, so it isn't stored). Absent until the section is first placed. */
export interface SectionLayout {
  x: number;
  y: number;
  w: number;
}

export interface BudgetSection {
  id: string;
  kind: BudgetSectionKind;
  title: string;
  items: BudgetItem[];
  collapsed?: boolean;
  layout?: SectionLayout;
  /** Header stripe colour override (hex). Falls back to the kind's default accent. */
  color?: string;
}

/** One named budget in a project's Money lens — a project can hold several. */
export interface Budget {
  id: string;
  name: string;
  sections: BudgetSection[];
  /** Canvas placement of the computed Summary card (it isn't a section). */
  summaryLayout?: SectionLayout;
}

/**
 * Top-level on-disk data shape. YYYY-MM-DD keys map to DayData.
 * The special keys `_recurring` and `_aiConfig` are also present.
 * The index signature is intentionally wide — callers narrow via getDayData().
 */
export interface CalData {
  _recurring: RecurringBlock[];
  /** Per-project inbox of un-timed tasks, shown on every day until scheduled. */
  _tasks?: InboxTask[];
  /** Per-project budgets for the Money lens. */
  _budgets?: Budget[];
  /** Owned by ai-import; opaque to the renderer */
  _aiConfig?: unknown;
  [dateKey: string]: DayData | RecurringBlock[] | unknown;
}

/**
 * One independent project in the workspace. `data` holds the Time lens (calendar events,
 * blocks, recurring tasks); the other framework lenses (People/Money/Materials/Scope/
 * Information) store their lists as reserved keys on that same CalData, like `_tasks`.
 */
export interface Project {
  id: string;
  name: string;
  data: CalData;
}

/**
 * Top-level on-disk shape (v3): a set of independent projects plus the active one.
 * `_aiConfig` also sits at this top level but is owned by the main process (ai-import.ts)
 * and is intentionally not modelled here — the renderer never reads or writes it.
 */
export interface Workspace {
  version: 3;
  activeProjectId: string;
  projects: Project[];
}

// ── AI types (shared between ai-import.ts and renderer.ts) ──────────────────

export interface AiConfig {
  provider: 'claude' | 'ollama' | 'openai';
  apiKey: string;
  mode: 'fetch' | 'websearch';
  ollamaUrl: string;
  ollamaModel: string;
  /** API key for Ollama's hosted web-search endpoint (web search mode only) */
  ollamaApiKey: string;
  interests: string;
  /** Free-text location used to bias web-search results (e.g. "Austin, TX, USA") */
  location: string;
  sites: string[];
  keywords: string[];
  /** Optional start of date range filter (YYYY-MM-DD) */
  dateRangeStart: string;
  /** Optional end of date range filter (YYYY-MM-DD) */
  dateRangeEnd: string;
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
  ollamaListModels(): Promise<string[]>;
  openExternal(url: string): void;
}
