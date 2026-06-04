# Changelog

## [Unreleased]

### Added
- Added a unified Schedule page mode toggle so the right-side schedule canvas can switch between `Daily` clock mode and a native day-scale `Schedule` timeline view while keeping one shared task list
- Added draggable start/end handles for one-off blocks in the native Schedule timeline so users can resize blocks directly on the day view
- Added a shared block details panel below the Schedule canvas, with per-block sub-task lists that can be viewed, added to, completed, and removed from either Daily or Schedule mode

### Changed
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
