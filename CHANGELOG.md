# Changelog

## [1.9.1] - 2026-06-18

### Changed
- **Increased all UI text ~12% for legibility.** Every `font-size` in `styles.css` (112 declarations) was converted from hardcoded `px` to `rem`, and a single root knob — `html { font-size: 70% }` — now scales all text at once (`1rem = 11.2px`, i.e. the old 10px baseline +12%). The conversion is 1:1 readable (old `13px` → `1.3rem`), so styles stay greppable; future global resizing is one number. `body` is anchored to `1.6rem` so inherited text grew with everything else rather than dropping to the root size.
- **Calendar control strip now scales with the window and stays on one row.** The day cells already grow to fill the window, but the control row above them (Month/Week/Day toggles + Import button, the date nav, and the Jan–Dec quick-jump) had fixed sizes and stayed constant. The strip is now fluid: `.react-schedule-main` is a size container and `.react-schedule-topbar` carries a single `font-size: clamp(0.8rem, calc(0.85rem + 0.51cqw), 1.875rem)` knob that tracks the calendar column's width (not the viewport, since the task sidebar shares the row); every control inside it (toggles, arrows, pills, labels, gaps) is sized in `em`, so they scale together. The clamp is anchored to the two window sizes in use — ~15px at 1280px wide, ~21px at 2560px. The strip layout changed from `1fr auto 1fr` to `auto 1fr auto` so the toggles and all 12 month buttons always get their full width (no more clipping the months off-screen at narrow widths); the date nav takes the flexible middle and shrinks first. The date label's `min-width` was also cut so the prev/next arrows hug the label instead of floating far from it.
- **Tightened the toggles and turned Today + Import into icons.** The Month/Week/Day toggles and the Import button now share the Jan–Dec pills' padding and gap so the left group reads as one size family. The text "Today" button became a discrete borderless calendar icon (inline Lucide-style SVG with a dot on today, muted with an accent hover), and the Import button's ★ glyph was replaced with a Lucide `calendar-plus` SVG ("add events to the calendar"), un-tinted to `--text-muted` so it matches the surrounding text and icons. Smaller and lighter, and it frees a bit more row space.
- **Settings button uses the Lucide gear icon.** The bottom-right Settings button's `⚙` glyph is now the Lucide `settings` SVG, consistent with the other vector icons; it keeps its discrete muted look and the rotate-on-hover.
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
