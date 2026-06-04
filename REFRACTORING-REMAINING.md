# Caldera Refactoring Remaining Work

## Current status

Completed:
- Added `postJson` helper in `src/ai-import.ts`
- Refactored `callClaude`, `callOllama`, and `callOpenAI` to use `postJson`
- Added `renderList` helper in `src/renderer.ts`
- Refactored `renderAiUrlList`, `renderAiKeywordList`, and `renderAiEventList`
- Added `saveCalendarDataAndRefresh(...)` helper in `src/renderer.ts`
- Replaced duplicate save/refresh patterns in event management flows
- Split shared DOM helpers into `src/renderer-ui.ts`
- Split calendar state, migration, persistence, and event mutation helpers into `src/renderer-data.ts`
- Split schedule rendering, timeline interactions, and task sidebar logic into `src/schedule.ts`
- Split clock rendering, block editing, and time-block persistence logic into `src/clock.ts`
- Split calendar grid rendering, hover strips, modal cards, and image drag/paste flows into `src/calendar-grid.ts`
- Split AI provider adapters into `src/ai/model.ts`
- Split headless AI page scraping into `src/ai/renderer.ts`
- Split AI response parsing, sanitization, and date-range filtering into `src/ai/parse.ts`
- Removed the temporary legacy schedule implementations from `src/renderer.ts`
- Removed the duplicated legacy clock implementations from `src/renderer.ts`
- Removed the duplicated legacy calendar/data implementations from `src/renderer.ts`
- Removed unused `png-to-ico` dev dependency
- Added a Node test harness and CI workflow for build/test verification
- Verified TypeScript build passes

## Remaining refactoring steps

### Phase 1: Verify and harden current changes
1. Manual smoke test the AI import workflow:
   - Open the AI settings modal
   - Save AI config
   - Run import
   - Review pending events
   - Add selected events and verify calendar rendering
2. Correct any bugs surfaced by the smoke test.

### Phase 2: Extract small utilities and remove remaining duplication
1. Completed: extended the shared calendar persistence helper to cover repeated save-and-schedule-refresh flows.
2. Completed enough for current scope: shared list rendering already lives in `src/renderer-ui.ts`, and the remaining DOM creation in `renderer.ts` is now mostly AI/settings/view wiring rather than calendar rendering duplication.
3. Completed: AI prompting, response repair/JSON extraction, and date-range filtering now live in dedicated `src/ai/*` modules and are easier to test.

### Phase 3: Split large files into focused modules
1. Continue splitting `src/renderer.ts` into smaller modules:
   - `src/renderer-data.ts` now owns calendar state, migrations, persistence, and event data helpers
   - `src/calendar-grid.ts` now owns `renderCalendarGrid`, `refreshCalendarCell`, hover strips, drag/drop, paste, and day-detail modal rendering
   - `src/schedule.ts` now owns schedule view rendering, timeline interactions, block details, and task list behavior
   - `src/clock.ts` now owns `buildClockSVG`, `arcPath`, popup editing, and time-block save/update/delete flows
   - `src/renderer-ui.ts` now owns shared DOM/render helpers and list rendering utilities
2. Leave `src/renderer.ts` as a bootstrap/wiring file with minimal logic.

### Phase 4: Split AI import into testable modules
1. Completed: `src/ai/model.ts` now owns provider adapters and prompt construction.
2. Completed: `src/ai/renderer.ts` now owns hidden page scraping and HTML extraction.
3. Completed: `src/ai/parse.ts` now owns event parsing, sanitization, validation, and filtering.
4. Completed: `src/ai-import.ts` now acts as the IPC/config entrypoint that ties the pieces together.

### Phase 5: Add tests and CI coverage
1. Completed: unit tests now cover pure helpers in `src/ai/parse.ts`, including date validation, URL sanitization, homepage detection, JSON repair, parsing, and date-range filtering.
2. Completed where practical for this architecture: pure AI helpers are covered, and the remaining renderer-side logic is still dominated by browser-global wiring rather than isolated pure helpers.
3. Completed: CI now runs `npm run build` and `npm test`.

## Notes
- The main remaining cleanup opportunity is the still-combined theme/shader/settings/view wiring that remains in `src/renderer.ts`, but it is no longer the primary maintainability risk.
- The remaining recommended validation step is a real manual smoke test of the AI import flow inside the running app.
- After these steps, the codebase should be easier to maintain and should produce a lower complexity score from tools like fallow.
