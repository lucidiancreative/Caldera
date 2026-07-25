# Changelog

## [1.41.0] - 2026-07-19

### Added
- **Location-aware event import.** Web Search mode now has a **"Your location"** field (e.g. `Austin, TX, USA`). It's injected into the search prompt as a hard constraint ("only include events in or near …") for every provider, and passed to OpenAI's `web_search_options.user_location` so the search itself is geographically biased. Fetch mode honors it too when it's set.
- **Web Search now works with OpenAI and Ollama, not just Claude.** The Import Mode selector (Fetch / Web Search) is available for all three providers:
  - **OpenAI** uses the `gpt-5-search-api` model, which searches the web before answering (Chat Completions + `web_search_options`).
  - **Ollama** uses its hosted web-search API (`ollama.com/api/web_search`), then hands the results to your local model to extract events. This needs an Ollama API key — a new **"Web Search API Key"** field in the Ollama panel, stored encrypted at rest via `safeStorage` like the other keys.

### Notes
- Both new API paths were implemented against the providers' current documented request/response shapes (OpenAI's `gpt-4o-*-search-preview` models are retired on 2026-07-23, so `gpt-5-search-api` is used instead).

### Fixed
- **Web Search event import now works.** The "Web Search" mode returned "No events found" on every run because its server-side-tool loop was written for client-side tools — it watched for a `tool_use` stop reason (which Anthropic's server-side `web_search` never emits) and fed the model empty `tool_result` blocks, while the real `pause_turn` continuation case fell through and discarded the result. Rewritten to drive the server tool correctly: take the model's answer on `end_turn`, and on `pause_turn` resume by re-sending the assistant turn (no injected tool results). The raw web-search response is now logged in dev for debugging.
- **Web Search now uses your saved keywords.** The search was seeded only from the free-text "Describe your interests" box and ignored saved keywords, so anyone who'd configured keywords (but not interests) searched for an empty string and got nothing. The search now falls back to the saved keywords when interests is blank, and running a web search with neither set returns a clear "Add some interests or keywords" message instead of a silent empty list.

### Changed
- **Bigger, colorful Money totals.** Each panel's **Total** row is now larger and tinted by financial meaning — green for income/assets, red for liabilities, orange for bills/expenses, blue for goals (custom panels stay neutral). The **Summary** card leads with three big colored **KPI tiles** — Net Worth, Surplus / mo, and Goals (surplus/net worth turn red when negative) — over a compact list of the supporting totals, each in the same semantic colors. (New `.budget-tone-*` classes + a `sectionTotalTone` helper; `BudgetSummary` reworked into tiles + rows.)

### Changed
- **"Add panel" replaces the per-type add menu.** Right-clicking the Money canvas now offers a single **Add panel** that drops a blank, customizable panel (a new `custom` section kind with one **Amount** column) instead of the six "Add Income / Add Goals / …" options. Rename it, recolor it, and add rows to make it whatever you need. The seeded default budget keeps its typed sections.

### Added
- **Recolor a panel's header stripe.** Each panel's right-click menu now has a **Panel color** picker — eight preset swatches plus a native custom-color picker — that live-updates the colored tab on its header. Applies to every panel (custom and seeded); the choice persists per budget and is carried along when a panel is duplicated. Section accent colors are now data-driven (`section.color ?? the kind's default accent`) rather than fixed per-kind CSS.

## [1.37.2] - 2026-07-19

### Changed
- **Larger, tighter Money budget text.** Bumped the budget grid's font size (`.budget-section` 0.92rem → 1.12rem) so it reads more easily on small screens, and roughly halved the vertical spacing to compensate (row min-height and section/summary padding). Scoped to the Money page only — the rest of the app is unchanged.

## [1.37.1] - 2026-07-18

### Fixed
- **Money dashboard sections now drag.** Cards showed the grab cursor but wouldn't move. **Root cause:** react-draggable's debug `log()` reads `process.env.DRAGGABLE_DEBUG`, which the vite build left unreplaced — so it threw `ReferenceError: process is not defined` in the sandboxed renderer the instant a drag started (`handleDragStart`). It's now defined away in `vite.config.ts` next to `process.env.NODE_ENV`. Two correctness hardenings landed alongside: react-grid-layout's `layout` is held in controlled React state (updated on drop, so a mid-drag re-render — height measurement or the async persist — can't hand RGL a conflicting array and revert the drop), and RGL's base positioning CSS is inlined into `styles.css` (this IIFE renderer bundle can't emit/link a separate stylesheet). Positions persist per budget across restarts.

## [1.37.0] - 2026-07-18

### Added
- **Money lens — drag-to-place dashboard + right-click menus.** Budget sections are now cards on a snap-to-grid canvas: grab a card by the **⠿ grip** in its header to move it, and it snaps to a 12-column grid while the others reflow (powered by `react-grid-layout`). **Right-click** the empty canvas to **add a section** (dropped where you clicked); right-click a section for **Add row / Duplicate / Collapse / Delete**. Card positions are saved per budget (the computed Summary is placeable too); section width/height stays automatic for now (move-only). Each card's height auto-fits its content. Positions persist across restarts.

### Notes
- `react-grid-layout@2.2.3` is added and loaded via `React.lazy`, so it only evaluates when the Money lens is opened. (The renderer ships as a single CSP-safe IIFE bundle, which can't code-split a separate chunk, so its ~22 kB gzip rides along in the main bundle; its base CSS is inlined into `styles.css` rather than importing the library stylesheet, since the bundle can't emit a separately-linked CSS file.)

## [1.36.0] - 2026-07-18

### Added
- **Money lens — a customizable planning budget.** The Money framework lens is now live. It re-creates a personal-budget spreadsheet as an editable grid of section cards — **Income · Assets · Liabilities · Bills · Other Expenses · Goals** — plus a computed **Summary** (Net Total, Total Monthly Expenses, Net Monthly Surplus, Goals Total, …). Each project can hold several **budgets** (e.g. Personal / Business), listed in the sidebar with add / inline-rename (double-click) / delete; a project's first budget auto-seeds from the reference sheet so it's useful immediately, and everything is editable afterward. Rows use **click-to-edit** cells (click a number or label, Enter/Tab to commit, Esc to cancel), nest to any depth for organization, and can be added, deleted, or given sub-items; sections can be added (from the fixed kinds), renamed, collapsed, or deleted. Column totals sum each column across the whole tree; the cross-section Summary is derived, never edited. Every change snapshots for undo/redo and persists per project. (New `src/react/lens/money/` — `budgetKinds`, `defaultBudget` seed, `MoneyLens`, `BudgetsSidebar`, `BudgetSection` engine, `EditableCell`, `BudgetSummary` — plus pure `moneySelectors` + `moneyActions`, a `_budgets` slice on `CalData` with its migration branch, and `formatMoney`. Rollup + action tests lock the reference figures: 1442 / 550 / 11,273.91 / 5,842.91 / 2,108 / 49,131.)

## [1.35.0] - 2026-07-18

### Changed
- **Themed date pickers on the Event Import modal.** The date-range fields now open a mini popup calendar styled to the app skin (frosted-glass surface, accent hover/selected states, greyed other-month days) instead of the OS's native date picker. Each field has a "Clear" and "Today" shortcut, and the popup flips above / shifts inward to stay on-screen. The range still saves as `YYYY-MM-DD`, so imports behave exactly as before.

## [1.34.0] - 2026-07-18

### Added
- **Event thumbnails on task-view day cells.** In the Month grid's Tasks view, each day now shows a row of small circular image thumbnails along its bottom-left corner — one per event assigned to that day (capped at 6, then a "+N" chip). Events without an image render as a plain accent dot so the count still matches. The scheduled-block list lifts to make room when a day has both.

## [1.33.1] - 2026-07-05

### Fixed
- **Day-view clock arcs always render with rounded corners again.** Removed the boundary-rounding logic that squared the shared edge between time-adjacent blocks (and could square corners incorrectly since it ignored AM/PM). Every block arc is now fully rounded regardless of its neighbors.

## [1.33.0] - 2026-07-05

### Added
- **Year picker dropdown.** A calendar-icon button on the left of the date nav opens a dropdown of years for quickly jumping to a different year (keeping the current month and clamping the day, so Feb 29 lands on Feb 28 in non-leap years).

### Changed
- **"Return to today" icon.** The jump-to-today button now uses a circular return (rotate) icon instead of the calendar-dot icon, making its "go back to now" purpose clearer.
- **Centered the month/year label.** The date-nav label is now centered between the two arrows instead of hugging the left.

## [1.32.0] - 2026-07-05

### Changed
- **Reworked the Month control strip.** The day-cell toggle now reads **Tasks / Events** (the old "Images" button is renamed to "Events") with Tasks on the left, and the **Event Import** button has moved out of the tab bar to sit just right of the Events toggle. Event Import now appears only in Month view alongside that toggle.

## [1.31.0] - 2026-07-05

### Added
- **Weekday and weekend repeat options for time blocks.** The block editor's Repeat dropdown now offers "Weekdays (Mon–Fri)" and "Weekends (Sat–Sun)" alongside daily/weekly/monthly, so a recurring block can be scheduled to appear only on working days or only on the weekend.

## [1.30.0] - 2026-07-05

### Changed
- **The block editor now uses explicit start + end times in both modes.** Editing an existing block exposes start and end time fields (replacing the old AM/PM-only choice), and creating a block now uses the same start + end fields instead of a start + duration picker. The header shows the resolved range live as you type. Time changes persist through the same save as the label and recurrence, so recurring "just today" edits detach a single re-timed occurrence while "all occurrences" re-times the whole series — all in one undo step.

## [1.29.0] - 2026-07-04

### Added
- **Deadline tasks.** A flag toggle on each sidebar task marks it as a deadline. When the task is scheduled onto the calendar (dragged to the Week timeline or dropped on a Month day-cell), the flag rides along to the block and draws a red outline everywhere it appears — the Month cell task pill (in Tasks view), the Week timeline, the Day clock arc and legend, and the sidebar task list — so deadlines stand out. The flag is preserved when a block is moved across days or converted to/from recurring.
- **Show/Hide recurring tasks.** A new Settings toggle hides recurring blocks from the Month calendar (Week, Day, and the sidebar list still show them). The preference persists across sessions and defaults to shown.

## [1.28.0] - 2026-07-04

### Added
- **Drag inbox tasks onto Month day-cards.** Dropping a task from the sidebar onto a day in the Month view opens the block editor pre-filled with the task's label, where you set a start time and duration before saving. Saving turns the task into a scheduled block on that day; a single undo reverts both the new block and the removed task. Cancelling leaves the task in the inbox.
- **Images ⇄ Tasks toggle for Month cells.** A single toggle in the calendar control strip flips every day-cell between its cover-image identity and a compact list of that day's scheduled blocks. The choice persists across sessions, and dropping a task automatically switches all cells to Tasks view so the new block is visible where it landed.

### Changed
- **The block editor's create mode now sets an explicit time.** Creating a block (from a Month task drop or a Week/Day drag) offers a start-time field plus a duration selector instead of only an AM/PM choice.

## [1.27.1] - 2026-06-21

### Changed
- **Moved the Week sub-task quick add.** The "Add a sub-task" input now appears at the top of the left sub-task column in the Week timeline sub-task panel, keeping the notes column reserved for sub-task notes.

## [1.27.0] - 2026-06-21

### Changed
- **Recurring Week timeline drags now detach one occurrence.** Moving or resizing a recurring block in Week view now converts only that visible occurrence into a one-time block by excluding the original recurrence on that date and creating a one-off override at the new time/day. The rest of the recurring series keeps its original schedule.

## [1.26.0] - 2026-06-20

### Changed
- **Trimmed the calendar date nav height.** The adaptive month/week/day nav now uses a single-line label, removing the secondary date text so the stacked calendar header takes less vertical space.

## [1.25.0] - 2026-06-20

### Changed
- **Stacked the date nav above the month strip.** The calendar header now places the adaptive month/week/day nav directly above the centered Jan-Dec quick-jump buttons, while keeping the Month/Week/Day view toggles anchored on the right of the button strip.

## [1.24.0] - 2026-06-20

### Changed
- **Centered the Jan-Dec quick-jump strip.** The calendar controls now place the adaptive month/week/day nav on the left, restore the full Jan-Dec quick-jump buttons in the centered top-bar position, and keep the Month/Week/Day view toggles on the right.

## [1.23.0] - 2026-06-20

### Changed
- **Condensed the month quick-jump into a 5-month wheel.** The calendar control strip now shows the active month with two neighboring months on each side, compact chevrons for stepping, and mouse-wheel/trackpad support, reducing top-bar crowding while keeping month jumps fast.

## [1.22.0] - 2026-06-20

### Changed
- **Rearranged the calendar control strip.** The Jan-Dec quick-jump buttons now align to the left side of the calendar pane, the Month/Week/Day view toggles align to the right, and the adaptive month/week/day date nav remains centered above the calendar area.

## [1.21.0] - 2026-06-20

### Added
- **Discrete Z3n Studio copyright mark.** The app now displays a small bottom-center `© 2026 Z3n Studio.` mark that follows the active theme, stays non-interactive, and avoids the bottom-right Settings control.

## [1.20.1] - 2026-06-20

### Changed
- **Improved selected Week timeline block outline.** Selected timeline blocks now use a two-layer ring with a bright inner contrast line and an outer accent halo, making the selected block easier to read across colorful gradients and active skins without changing layout.

## [1.20.0] - 2026-06-20

### Added
- **Backspace deletes the selected Week timeline block.** In Week view, pressing Backspace now removes the currently selected time block while ignoring keystrokes from editable fields and open modals/editors. Recurring blocks remove only the selected day's occurrence.

### Removed
- **Removed the task-list move-to-day control.** Blocks are now moved between days through the Week timeline drag interaction, so the redundant move button and inline reschedule row were retired from the task sidebar.

## [1.19.0] - 2026-06-20

### Added
- **Persistent selected time block for sub-tasks.** The schedule now remembers the selected time block per project in local storage, so switching away from the Time page or toggling Month/Week/Day no longer leaves the Week sub-task section empty when the user returns. The remembered selection is validated against the current project data and is cleared automatically if the block no longer exists.

## [1.18.2] - 2026-06-20

### Fixed
- **Tooltip positioning and timing.** Pointer tooltips now wait briefly before appearing and flip above the cursor near the bottom of the window instead of being clamped far away from the pointer, fixing the Settings icon tooltip placement.

## [1.18.1] - 2026-06-20

### Changed
- **Tooltips now follow the active theme and skin.** The shared tooltip layer no longer uses a fixed dark gray surface; its background, border, text, blur, and shadow now draw from the current Caldera CSS variables so default, dark, glass, and frost skins stay visually consistent.

## [1.18.0] - 2026-06-20

### Added
- **Consistent in-app tooltip styling.** Native Electron title tooltips are now intercepted by a shared React `TooltipLayer`, which renders one compact app-styled tooltip for existing `title` attributes across window controls, tabs, schedule controls, task actions, and timeline blocks. The layer supports pointer hover and keyboard focus, clamps to the viewport, and suppresses the default OS tooltip chrome without requiring every tooltip call site to be rewritten.

## [1.17.0] - 2026-06-20

### Changed
- **Tabs are now Projects (workspace renamed calendars → projects).** Each browser-style tab is conceptually a project rather than a calendar, matching the framework-lens direction. User-facing copy updated ("New project", "Delete project", and the delete confirmation). Internally the on-disk workspace upgraded from v2 to **v3**: `calendars` → `projects` and `activeCalendarId` → `activeProjectId` (`Calendar` type → `Project`, `CalendarTab` → `ProjectTab`, `getActiveCalendar` → `getActiveProject`, new project ids prefixed `proj_`). Existing v2 (and legacy v1) data migrates automatically on first load and is re-saved once — each calendar becomes a project with its events, blocks, and recurring tasks intact. The `calderaTabs` bridge keeps its name (these are still tabs). The Time-lens calendar **data** model (`CalData`, `CalendarEvent`, the schedule engine) is unchanged.

## [1.16.0] - 2026-06-20

### Added
- **Project framework lenses (foundation).** The sidebar now leads with a row of six icons — **People · Time · Money · Materials · Scope · Information** — that switch the whole view between the parts of the project-management framework. The add-task input and task list moved down beneath the icons to make room. **Time** is the existing calendar (Month/Week/Day, the task inbox, drag-to-schedule) and works exactly as before; the other five lenses are labelled placeholders that we'll fill in stage by stage. This is the first step in evolving Caldera from a multi-calendar app into a multi-project workspace. (New `src/react/lens/` module: `lenses.tsx` registry with inline Lucide icons, `LensBar`, the shared two-column `LensLayout`, `ProjectWorkspace` owning the active lens, and `PlaceholderLens`. `SchedulePage` is now the Time lens rendered through `LensLayout`; the sidebar column split into an outer `.lens-sidebar` holding the pinned lens bar above the scrolling `.task-sidebar`.)

## [1.15.0] - 2026-06-20

### Added
- **Zoom controls and viewport persistence for the Week timeline.** The Week timeline now has compact zoom out/in controls that scale the horizontal hour grid from a dense overview to a wider detailed view while keeping the currently visible time centered. The timeline saves its zoom level plus horizontal and vertical scroll position in local storage, so leaving and returning to Week view restores the timeline to the same place.

## [1.14.0] - 2026-06-20

### Added
- **Sub-task notes in the Week lower panel.** The sub-task section beneath the Week timeline is now split into two halves: the left side keeps the selected block's sub-task list and add controls, while the right side provides a dedicated **Sub-task notes** editor for the selected sub-task. Notes are stored directly on each sub-task, persist with the calendar data, and are removed naturally when that sub-task or its parent block is deleted. Existing saved sub-tasks migrate with empty notes so older calendar data keeps loading cleanly.

## [1.13.1] - 2026-06-19

### Fixed
- Past time blocks now fade correctly in the Frost and Glass skins. The Day view's legend chips (`.block-chip`) were staying fully opaque for elapsed blocks under `skin-glass` and the light Frost shaders (Arctic/Glacier/Teal), because those skins carried an `opacity: 1` declaration that out-specified the `.block-chip.is-past { opacity: 0.5 }` fade added in 1.13.0. The redundant reset was removed (the base chip already defaults to opacity 1), so past chips now dim in every skin. The Week timeline bars and Day clock arcs were already fading correctly — they have no skin-specific opacity override.

## [1.13.0] - 2026-06-19

### Changed
- **Sub-tasks moved to their own section beneath the Week timeline.** Sub-tasks used to be tucked inside the left task list, expanding under whichever block was selected. They now live in a dedicated section below the Week view's timeline: select a block (in the left list or by clicking a timeline bar) and its sub-tasks — with add, complete, and delete — appear there under the block's name and time. To make room, the timeline now sizes to its day rows (`flex: 0 1 auto` instead of `height: 100%`), so the empty space that used to sit below the last day row is reclaimed by the new section; when the week is taller than the available space the timeline shrinks and scrolls internally as before. Sub-task editing is now a Week-view feature — the left list shows only the block list (the Day and Month views no longer surface sub-tasks). (New `SubtaskSection` driven by the existing selection; the inline sub-task UI and its `.task-subtasks`/`.task-subtask-add` styles were removed from `TaskList`; `SchedulePage` wraps the timeline and section in a `.react-schedule-week` column.)

## [1.12.0] - 2026-06-19

### Added
- **Drag time blocks between days on the Week timeline.** A block can now be dragged off its own row and dropped onto any other day's row — repositioning the day and the time in one motion, instead of only sliding along its original day. While you drag across rows the source block dims in place and a dashed ghost previews exactly where it will land (the destination row highlights like an inbox-task drop); the grab offset and 15-minute snapping are unchanged, so a moved block keeps its duration and lands under the pointer. The whole move is a single undo step. Same-day drags behave exactly as before. Recurring blocks stay on their own row (they recur on a rule, not a stored date) and continue to only change time. (`TimelineMode.beginMove` now hit-tests the row under the pointer and routes a cross-day drop through a new atomic `moveBlockToDate` action that relocates the one-off block and sets its new time in a single snapshot/save.)

## [1.11.1] - 2026-06-19

### Fixed
- Fixed Week timeline cursor-to-time mapping after horizontal scrolling. Drag-created blocks now preview and land under the pointer, and existing blocks keep moving with the cursor instead of stopping early from an accidental double-count of the scroll offset. The inbox task drop path uses the same corrected mapping.

## [1.11.0] - 2026-06-19

### Added
- **Drag inbox tasks onto the Week timeline to schedule them.** Grab a task from the sidebar inbox and drop it on any day row in Week view — it becomes a 60-minute block at the drop time (snapped to 15 min, clamped to the day), leaves the inbox, and is selected so you can immediately fine-tune it with the timeline's existing move/resize handles. The whole drop is a single undo step (Ctrl+Z brings the task back and removes the block). Uses the native HTML5 drag-and-drop API (no new dependency) and reuses the same x→time mapping and block-creation domain logic as drawing a block by hand, so a dropped block is indistinguishable from a drawn one. (`TaskInbox` items are now `draggable`; `TimelineMode` day tracks accept the drop via a shared `taskDnd` contract; a new `scheduleInboxTask` action does the task→block conversion.) Dropping onto the Day clock face is a planned fast-follow.

## [1.10.0] - 2026-06-19

### Added
- **Quick-add task inbox in the sidebar.** A "+ Add task" input pinned to the top of the left sidebar lets you capture tasks without picking a date or time — type a name, press Enter, and it drops into the inbox below while the field stays focused for the next one (type, Enter, type, Enter…). Inbox tasks are checkable and deletable, and they live in a per-calendar inbox (`calData._tasks`) shown on every day until scheduled, so each tab keeps its own backlog. Groundwork for an upcoming drag-and-drop that will turn an inbox task into a scheduled time block by dropping it onto the timeline. (`TaskInbox` + `inboxActions` + a `getInboxTasks` selector; the left column is now a `.task-sidebar` wrapper that owns the fluid width and scroll, with `TaskList` rendering the scheduled blocks beneath the inbox.)
- The workspace migrator now preserves the `_tasks` key on load (alongside `_recurring`), so the inbox survives restarts instead of being mistaken for a legacy day entry.

## [1.9.1] - 2026-06-18

### Changed
- **Increased all UI text ~12% for legibility.** Every `font-size` in `styles.css` (112 declarations) was converted from hardcoded `px` to `rem`, and a single root knob — `html { font-size: 70% }` — now scales all text at once (`1rem = 11.2px`, i.e. the old 10px baseline +12%). The conversion is 1:1 readable (old `13px` → `1.3rem`), so styles stay greppable; future global resizing is one number. `body` is anchored to `1.6rem` so inherited text grew with everything else rather than dropping to the root size.
- **Calendar control strip now scales with the window and stays on one row.** The day cells already grow to fill the window, but the control row above them (Month/Week/Day toggles + Import button, the date nav, and the Jan–Dec quick-jump) had fixed sizes and stayed constant. The strip is now fluid: `.react-schedule-main` is a size container and `.react-schedule-topbar` carries a single `font-size: clamp(0.8rem, calc(0.85rem + 0.51cqw), 1.875rem)` knob that tracks the calendar column's width (not the viewport, since the task sidebar shares the row); every control inside it (toggles, arrows, pills, labels, gaps) is sized in `em`, so they scale together. The clamp is anchored to the two window sizes in use — ~15px at 1280px wide, ~21px at 2560px. The strip layout changed from `1fr auto 1fr` to `auto 1fr auto` so the toggles and all 12 month buttons always get their full width (no more clipping the months off-screen at narrow widths); the date nav takes the flexible middle and shrinks first. The date label's `min-width` was also cut so the prev/next arrows hug the label instead of floating far from it.
- **Tightened the toggles and turned Today + Import into icons.** The Month/Week/Day toggles and the Import button now share the Jan–Dec pills' padding and gap so the left group reads as one size family. The text "Today" button became a discrete borderless calendar icon (inline Lucide-style SVG with a dot on today, muted with an accent hover), and the Import button's ★ glyph was replaced with a Lucide `calendar-plus` SVG ("add events to the calendar"), un-tinted to `--text-muted` so it matches the surrounding text and icons. Smaller and lighter, and it frees a bit more row space.
- **Settings button uses the Lucide gear icon.** The bottom-right Settings button's `⚙` glyph is now the Lucide `settings` SVG, consistent with the other vector icons; it keeps its discrete muted look and the rotate-on-hover.
- **Date nav now shows a second line in every view.** The sub-label specifying the focused day (e.g. "Wednesday, June 17, 2026") now appears in Month and Week views, not just Week. Because the Day view's main line is already the full date, it shows a relative descriptor instead ("Today" / "Tomorrow" / "In 3 days" / "2 days ago") via a new `formatRelativeDay` helper — so all three lenses have a consistent two-line nav.
- **Moved Event Import to the tab bar.** The calendar-plus Import button now lives in the top tab bar, to the right of the **+** add-tab button, instead of in the Month/Week/Day toggle group. `App` passes the open-import handler to `TabBar` (via a new `onOpenAi` prop); `SchedulePage` no longer owns it, and the now-dead `.react-schedule-ai` styles were removed. In the tab bar it matches the add-tab button's size.
- **Matched the three Lucide icons.** Import, Today, and Settings now render at the same size and `1.5` stroke weight. Today's icon dropped from `1.25em` to `1.1em` to match the Import icon (its padding was raised to keep the button box matched to the nav arrows); the Settings button is a fixed size (`1.5rem`) since it floats outside the scaling calendar column.
- **Task list now scales with the window too.** Previously the left sidebar was a fixed `220px` column with fixed `rem` text, so it stayed put while the calendar grew. `.react-schedule-body` is now a size container; the panel width is fluid (`clamp(190px, 17.5cqw, 320px)`) and `.task-list` carries a `clamp(…cqw…)` base font with every descendant (items, labels, times, buttons, swatches, sub-tasks, inputs, padding, gaps) converted to `em` — so the whole sidebar scales with the window like the calendar side. Borders and radii stay in `px`.
- **Flatter control row.** Removed the resting wire outline (`1px var(--border)`) from the unselected Month/Week/Day toggles and the Import button — the box is kept transparent so the outline now appears only on the active toggle (accent), with no layout shift. The Import button also drops its surface fill to read as a flat icon like the others.

## [1.9.0] - 2026-06-18

### Added
- **Multiple independent calendars via browser-style tabs.** A tab bar below the titlebar lets you keep several fully separate calendars — each with its own events, time blocks, and recurring tasks — and switch between them like browser tabs. **+** adds a calendar, **double-click** renames inline, **×** deletes (via a themed in-app confirmation dialog that matches the skin/theme; the last calendar can't be closed), and **drag** reorders. Tabs and the active selection persist across restarts. (`TabBar` + `useCalderaTabs` over a new `window.calderaTabs` bridge.)

### Changed
- On-disk format upgraded to a versioned multi-calendar workspace: `{ version: 2, activeCalendarId, calendars: [{ id, name, data }] }`. Existing single-calendar files migrate automatically on first launch, and a one-time `calendar-data.v1.bak.json` backup is written beside the data file before the upgrade. Internally `calData` is now a pointer to the active calendar's data, so all existing event/schedule logic operates on the active tab unchanged; undo/redo is scoped per calendar. View state (focused date + lens) is shared across tabs.
- AI import settings (`_aiConfig`) are now global (shared by all calendars) and owned solely by the main process — `save-data` preserves them so a routine data save never drops your AI configuration.

### Removed
- Retired the unused `activeView` view-routing state and the `ViewType` type left over from the old Calendar/Schedule split that the consolidated view (1.8.0) replaced.

---

## [1.8.0] - 2026-06-18

### Changed
- Consolidated the separate Calendar and Schedule views into one workspace with three lenses — **Month**, **Week**, and **Day** — chosen from a single mode toggle. The top-bar Calendar/Schedule toggle is gone; in its place a single **adaptive date nav** sits just above the main UI and steps by month, week, or day to match the active lens (new `ScheduleNav` component + `stepMonthKey` helper), with the **Jan–Dec quick-jump strip** kept right beside it (reuses the `.month-tab` styling; `withMonth` helper). The monthly image calendar is now the Month lens and the default on launch; the task sidebar stays visible alongside it in every lens. Clicking a day in Month still opens the existing image/notes day modal, and the Event Import (★) action moved into the new control row. Internally the calendar month/year and schedule date collapsed to one shared focused date. (Phase A of the multi-calendar workspace — independent, tabbed calendars land in Phase B.)

---

## [1.7.19] - 2026-06-18

### Changed
- The Schedule Daily clock now shows the whole day on one 12-hour face instead of filtering by an AM/PM toggle, so upcoming afternoon/evening blocks are visible without switching modes (e.g. a 4–6 PM block is now seen in the morning). Both AM and PM blocks paint at their clock position; fade is driven purely by time via `isBlockPast` — past blocks recede to a faded-but-visible `.is-past` arc (and stay clickable), while current/upcoming blocks stay solid. Past arcs paint first so an AM/PM pair landing on the same wedge keeps the upcoming one on top. The legend lists every block for the day (sorted, past chips dimmed).
- Past blocks on the Schedule Timeline (linear) view now fade to `opacity: 0.2` as well, matching the clock's done-vs-upcoming treatment so the two views read consistently.

### Removed
- Removed the now-redundant AM/PM toggle from the Daily clock, plus its dead `.ampm-btn` / `.rdaily-ampm` styles (base + all skin overrides) and the stale `.ampm-btn` entry in the glass button light-follow list. Drag-to-create now defaults a new block's AM/PM to the next occurrence of the dragged spot (new pure helper `inferClockBlockAmpm`, covered by unit tests); the block editor's AM/PM dropdown still overrides before saving.

---

## [1.7.18] - 2026-06-18

### Fixed
- Fixed the day-event modal image preview not opening the fullscreen lightbox on click. The React migration moved the click handler onto the `<img>` itself, but `.card-img` still carried `pointer-events: none` (a holdover from the old container-delegated click), so the handler could never fire — only the `zoom-in` hover cursor survived. Removed the `pointer-events: none` rule and added `draggable={false}` to the image so clicking now opens the lightbox without enabling native image-drag.

---

## [1.7.17] - 2026-06-17

### Fixed
- Made the Schedule Timeline blocks taller (`BAR_HEIGHT` 38→52, `LANE_HEIGHT` 48→62) so each block's title fits and is no longer clipped by the bar's `overflow: hidden`; the label + time rows now have room to render in full.

---

## [1.7.16] - 2026-06-11

### Removed
- Completed the vanilla→React migration cleanup (Phase C): deleted the retired vanilla `schedule.ts`, `calendar-grid.ts`, and `clock.ts`, plus the dead clock UI, calendar-navigation, settings-modal, and AI-import clusters and their backing module state/types in `renderer.ts`/`renderer-data.ts`. The live React UI is unchanged and `renderer.ts` is ~1000 lines lighter; this removes the runtime symbol-drift hazard behind the v1.7.15 bug. The schedule write bridge (`saveTimeBlock`/`updateTimeBlock`/`deleteTimeBlock`) moved into `renderer.ts` beside its `window.calderaSchedule` wiring.

### Changed
- Replaced the transitional `loaded-runtime-symbols` test with `renderer-script-manifest`, which asserts the renderer's compile list (`tsconfig.renderer.json`) and load list (`index.html`) stay aligned — a durable guard against the script-manifest drift that caused the v1.7.15 runtime error.

---

## [1.7.15] - 2026-06-11

### Fixed
- Fixed React Schedule time-block creation and editing throwing "Could not save the block" whenever the block's AM/PM differed from the app's current half-day — `saveTimeBlock`/`updateTimeBlock` still called `setScheduleAmPm`, which was left behind in the retired (no-longer-loaded) vanilla `schedule.ts` and threw `ReferenceError: setScheduleAmPm is not defined` at runtime; they now update the shared `clockAmPm` meridian directly

### Testing
- Added a regression guard asserting the live schedule-bridge functions (`saveTimeBlock`/`updateTimeBlock`/`deleteTimeBlock`) never call symbols that exist only in the compiled-but-unloaded vanilla views

---

## [1.7.14] - 2026-06-11

### Fixed
- Rolled back React Schedule block-creation mutations when the underlying bridge save fails, so failed saves no longer leave phantom time blocks behind or stack duplicates on retry

### Testing
- Added regression coverage for failed React `createBlock` bridge calls to ensure calendar data is restored after a rejected save

---

## [1.7.13] - 2026-06-11

### Fixed
- Made the React add-block modal behave explicitly for new blocks by requiring a non-empty label before Save can run, instead of silently treating an empty-label save as a cancel
- Added inline save-error feedback in the React block editor so failed create/update attempts no longer look like a dead Save button

### Testing
- Added regression coverage for the new-block save validation rule used by the React block editor

---

## [1.7.12] - 2026-06-11

### Fixed
- Prevented duplicate one-off block creation from identical in-flight React Schedule saves in the weekly Timeline flow
- Fixed the React Schedule focused-day sync so creating or selecting a block on a different week row no longer snaps the header back to a stale day

### Testing
- Added a regression test covering concurrent identical React `createBlock` requests so one modal save cannot fan out into multiple stored blocks

---

## [1.7.11] - 2026-06-11

### Added
- Expanded the React Timeline scheduler into a full Sunday-through-Saturday week view with one horizontal timeline row per day

### Changed
- Kept the Schedule task list focused on the selected day while allowing Timeline selection, drag-create, drag-move, and resize interactions from any visible week row
- Updated the Schedule header and timeline styling to show the active week range, focused day, and stacked weekday labels more clearly

### Testing
- Added regression coverage for week-range date helpers and per-day timeline occurrence keys used by recurring blocks in the weekly timeline

---

## [1.7.10] - 2026-06-11

### Changed
- Kept the current-day number indicator red across every theme and skin by separating its calendar styling from skin-specific `today` accent tokens

---

## [1.7.9] - 2026-06-11

### Added
- Added a thin red outline for the current day on the calendar grid that stays consistent across all themes and skins

---

## [1.7.8] - 2026-06-10

### Fixed
- Restored React Schedule sub-task add/delete and one-off block reschedule actions by moving those mutations into the live React store instead of routing through an unloaded legacy schedule script

### Testing
- Added regression tests for React Schedule sub-task mutations and one-off day moves, including blank-label and no-op move cases

---

## [1.7.7] - 2026-06-10

### Fixed
- Reduced the remaining Settings modal transparency in frost and glass skins so its text matches the readability of the other modals

---

## [1.7.6] - 2026-06-10

### Fixed
- Prevented duplicate React schedule block creation by locking the block editor to a single in-flight save or delete action while it persists

---

## [1.7.5] - 2026-06-10

### Changed
- Moved the Settings button out of the titlebar to a discrete floating gear in the bottom-right corner, fading in on hover

---

## [1.7.4] - 2026-06-10

### Added
- Added direct click-and-drag repositioning for React Timeline blocks, with live preview while dragging and preserved block duration on drop

---

## [1.7.3] - 2026-06-10

### Added
- Added direct drag-to-create block drawing in the React Timeline view, using the same shared block editor flow as Daily mode

---

## [1.7.2] - 2026-06-10

### Fixed
- Restored fully rounded Daily clock block geometry in the React scheduler and removed seam gaps when adjacent blocks touch on the clock face

---

## [1.7.1] - 2026-06-10

### Fixed
- Restored full-size rendering for the React Daily clock so the schedule canvas uses the available space again
- Restored icon-only task and sub-task action buttons in the React Schedule task list
- Timeline block resizing now previews live during drag, and shared boundaries between touching blocks now resize both adjacent blocks together

---

## [1.7.0] - 2026-06-10

### Added
- Completed the React renderer migration so the calendar grid, day modal, settings modal, and AI import/review flows now run from the React app instead of the legacy DOM shell
- Added a unified Schedule page mode toggle so the right-side schedule canvas can switch between `Daily` clock mode and a native day-scale `Schedule` timeline view while keeping one shared task list
- Added draggable start/end handles for one-off blocks in the native Schedule timeline so users can resize blocks directly on the day view
- Added a shared block details panel below the Schedule canvas, with per-block sub-task lists that can be viewed, added to, completed, and removed from either Daily or Schedule mode
- Scaffolded the renderer's React migration (Phase 0): added Vite, React 19, and Zustand, building the React island as a single IIFE bundle that mounts beside the existing vanilla renderer over `file://` without loosening the strict CSP
- Wired the React migration's shared data layer (Phase 1): the vanilla renderer exposes a `window.calderaBridge` over the single `calData` source of truth, and a Zustand store mirrors it reactively so React reads live data without a second copy; added pure, unit-tested scheduling selectors
- Built the React Schedule view foundation (Phase 2, part 1): a `SchedulePage` shell with shared date navigation and a task list that renders blocks (with inline sub-tasks per the chosen task model) from the shared store, reusing the existing task styling, with block and sub-task completion toggles persisting through the bridge — built and verified in isolation, not yet routed from the Schedule tab
- Built the React timeline mode (Phase 2, part 2): a day-scale timeline that stacks overlapping blocks into separate lanes (unit-tested greedy lane packing) instead of the vanilla single-lane collision, reuses the existing bar styling, and opens scrolled to the earliest block — verified in isolation
- Built the React daily clock mode (Phase 2, part 3): a faithful SVG port of the analog clock with the AM/PM toggle, dimmed AM overlay in PM, a live hand, and arc/chip colors painted from a new appearance bridge so they match the active skin exactly; arc geometry is unit-tested — verified in isolation
- Wired the React editing actions (Phase 2, part 4): edit (a block-editor modal), delete (with recurring today/all scope), reschedule one-off blocks to another day, add/delete sub-tasks, and drag-on-the-clock-ring to create a block — all flowing through a new schedule bridge that reuses the vanilla domain logic and persists + notifies; verified that edits and drag-create round-trip into the React DOM
- Routed the Schedule tab to the React view (Phase 2, part 5): a view bridge lets the React island take over the Schedule page (the vanilla clock/timeline view is now retired and stays hidden) while the vanilla calendar grid still owns the Calendar tab — verified live in the real app, tabbing in and out with no errors. This replaces the imperative full-rebuild-on-every-interaction schedule renderer that caused the jank

### Changed
- Retired the legacy renderer-owned HTML shell from `index.html`; the shipped renderer now boots from the React root plus the remaining bridge/bootstrap scripts only
- Renamed the Schedule page's second mode from `Schedule` to `Timeline` to remove the `Schedule`/`Schedule` label collision
- Reclassified Caldera as proprietary freeware in the project metadata and end-user documentation
- Rewrote the bundled license text to clearly grant no-cost use while keeping redistribution, modification, resale, and relicensing restricted
- Reworked the Schedule page shell to support a first-party timeline renderer instead of a separate standalone Gantt page
- Split shared renderer DOM helpers and schedule interactions into dedicated global scripts so `renderer.ts` can keep shrinking toward bootstrap-only wiring
- Removed the temporary legacy schedule layer from `renderer.ts` now that the extracted schedule script owns the live behavior
- Extracted the clock/time-block renderer and editor into `src/clock.ts`, and removed the duplicated legacy clock implementation from `renderer.ts`
- Extracted calendar state/persistence helpers into `src/renderer-data.ts` and calendar grid/modal rendering into `src/calendar-grid.ts`, removing the old in-file calendar/data implementations from `renderer.ts`
- Split AI import into dedicated `src/ai/model.ts`, `src/ai/renderer.ts`, and `src/ai/parse.ts` modules, leaving `src/ai-import.ts` as the IPC/config entrypoint
- Extended the shared calendar persistence helper so schedule mutations can reuse one save-and-rerender path instead of repeating `saveCalendarData()` plus schedule refresh logic
- Timeline edge resizing now auto-shifts neighboring one-off blocks to preserve order and keep Daily mode in sync with Schedule mode
- Reworked the Schedule timeline editor to use shared boundary handles between adjacent one-off blocks, rather than independent bar-edge resizing
- Schedule blocks now open into a shared selection model, so the task list, clock arcs, legend chips, and timeline bars all target the same block detail surface instead of sending timeline clicks straight back to Daily mode

### Fixed
- React calendar cells now refresh time-sensitive UI from the live bridge, including day rollover and schedule block colors after theme or skin changes
- React Schedule now accepts external date changes from the calendar/day modal flow, keeping tab navigation and per-day scheduling aligned
- Restored local startup by fixing the invalid `package.json` JSON syntax
- `npm start` now launches Electron through a wrapper that clears `ELECTRON_RUN_AS_NODE`, preventing Node-mode startup failures in contaminated shells
- Consolidated schedule block rendering so clock arcs, drag preview, legend chips, and task swatches share one gradient pipeline
- Added palette-slot migration for time blocks so skins re-theme existing schedule blocks consistently instead of persisting mismatched per-skin hex colors
- Unified rounded block geometry and cross-skin block styling so skins now differ by palette treatment rather than shape/opacity behavior
- Fixed schedule block AM/PM assignment so new blocks inherit the active schedule toggle instead of the current real-world time, and added an explicit AM/PM selector in the block popup for correcting older mis-tagged blocks
- Added skin-aware styling and native scrolling behavior for the first custom Schedule timeline surface
- Removed artificial minimum-width stretching from timeline bars so displayed widths match real scheduled durations more accurately
- Unified Schedule timeline resizing around one visible single-lane sequence, so one-off and recurring blocks now share the same draggable boundaries instead of splitting into separate lanes
- Removed implicit edit-on-double-click from schedule block surfaces so clicking a block consistently opens its sub-task details without unexpectedly bouncing the view back to Daily mode
- Vendored the DM Sans typeface locally (`fonts/`) so it renders offline within the strict CSP instead of being silently blocked from Google Fonts; dropped the unused Outfit web font
- Schedule timeline now opens scrolled to the earliest block instead of midnight, so days with no early-morning blocks no longer appear empty on first view

### Testing
- Added Node-based unit tests for AI parsing/date-filter helpers and a CI workflow that runs `npm run build` and `npm test`

---

## [1.4.0] - 2026-04-27

### Security
- DevTools now only opens in development builds (`app.isPackaged` check)
- Added `.env*` patterns to `.gitignore` to prevent accidental credential commits
- Debug logging in AI import now gated to development builds only
- Added warning when configuring Ollama with HTTP on non-localhost endpoints

### Added
- Shader toggle in Appearance modal (Auto/On/Off)
- Low-power mode detection via Battery API - automatically disables shader when battery < 20%
- Respects `prefers-reduced-motion` system preference in Auto mode

### Changed
- AI import logs use `debugLog()` wrapper that only outputs in development

---

## [1.3.0] - 2026-04-26

### Added
- Color palettes for Arctic, Glacier, and Teal skins
- Date range filters for AI event import

### Fixed
- Modal color mismatches for different skins
- Theme and button inconsistencies
- Time block dropdown color

---

## [1.2.0] - Previous

- Initial TypeScript migration
- Multi-event calendar support
- AI import via Claude, OpenAI, and Ollama
- Glass skin variants with WebGL shader backgrounds
