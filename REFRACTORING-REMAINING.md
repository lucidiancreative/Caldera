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
- Split schedule rendering, timeline interactions, and task sidebar logic into `src/schedule.ts`
- Removed unused `png-to-ico` dev dependency
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
1. Add a shared calendar mutation helper for repeated `pushCalendarSnapshot + save + render` sequences if any remain.
2. Extract DOM creation helpers in `src/renderer.ts` for repeated patterns such as:
   - event row rendering
   - schedule block details panel rows
   - timeline cell construction
3. Extract AI model prompting and parsing helpers in `src/ai-import.ts`:
   - shared prompt builder
   - response repair/JSON extraction helper
   - `filterEventsByDateRange` and parsing helpers should be easier to test

### Phase 3: Split large files into focused modules
1. Continue splitting `src/renderer.ts` into smaller modules:
   - `src/renderer-data.ts` or `src/data.ts` for calendar state, migrations, and data helpers
   - `src/calendar-grid.ts` for `renderCalendarGrid`, `refreshCalendarCell`, and hover/drag helpers
   - `src/schedule.ts` now owns schedule view rendering, timeline interactions, block details, and task list behavior
   - `src/clock.ts` is still a good follow-up target for `buildClockSVG`, `arcPath`, and clock interaction logic
   - `src/renderer-ui.ts` now owns shared DOM/render helpers and list rendering utilities
2. Leave `src/renderer.ts` as a bootstrap/wiring file with minimal logic.

### Phase 4: Split AI import into testable modules
1. Create `src/ai/model.ts` for provider adapters (`claude`, `ollama`, `openai`).
2. Create `src/ai/renderer.ts` for hidden page scraping and HTML extraction.
3. Create `src/ai/parse.ts` for event parsing, sanitization, validation, and filtering.
4. Keep `src/ai-import.ts` as the entrypoint that ties the pieces together.

### Phase 5: Add tests and CI coverage
1. Add unit tests for pure helpers in `src/ai/parse.ts`:
   - `isValidCalendarDate`
   - `sanitizeSourceUrl`
   - `isLikelyHomepage`
   - `tryParseJsonArray`
   - `parseEventText`
2. Add unit tests for renderer helper functions where possible.
3. Add a build/test step to CI that runs `npm run build` and the new test suite.

## Notes
- The biggest remaining maintainability risk is `src/renderer.ts` and `src/ai-import.ts`, which still contain large, complex functions.
- `src/schedule.ts` is now the live owner of schedule rendering and interactions, but `src/renderer.ts` still contains renamed legacy schedule implementations that should be deleted once the split has been smoke-tested.
- The priority is to break those large functions into smaller, readable pieces while preserving existing app behavior.
- After these steps, the codebase should be easier to maintain and should produce a lower complexity score from tools like fallow.
