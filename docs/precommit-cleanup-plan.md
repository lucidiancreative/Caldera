# Pre-Commit Cleanup Plan — React/Vite Migration

## Status

Draft, 2026-06-10. Written before committing the React + Vite migration on
`feature/react-migration`. Combines a manual codebase audit with the `npx fallow`
report. The migration is functionally further along than the docs imply: **React now
renders the entire UI** (titlebar, month strip, calendar, schedule, all modals) into
`#react-root` — see [App.tsx](../src/react/App.tsx). What remains is the migration's own
**Phase 4 cleanup**, which was not done, plus **one real runtime regression** the tooling
could not detect.

## How to read the fallow report (important)

Fallow analyses the **ES-module import graph**. The old vanilla renderer does **not** use
imports — it is a set of `<script>` tags sharing `window.*` globals (see the five script
tags in [index.html](../index.html#L14-L18)). So fallow's structural verdicts are partly
wrong for this repo:

- It flags real dead code (good).
- It flags **false positives** — files that are entry points it can't see (e.g.
  `preload.ts`), or bridges consumed via `window.calderaBridge` rather than `import`.
- It **misses a runtime bug** caused by a `<script>` that isn't loaded — invisible to an
  import-graph tool.

Every item below was verified by hand against the actual load path, not taken from fallow
on faith.

---

## P0 — Runtime regression: three React Schedule actions throw `ReferenceError`

**This is the one item that should be fixed before (or in) the commit. It is a real,
user-facing break, not a style nit.**

### Root cause

React routes its schedule writes through `window.calderaSchedule`
([actions.ts:93-119](../src/react/store/actions.ts#L93-L119)), which is installed by the
vanilla renderer ([renderer.ts:269-276](../src/renderer.ts#L269-L276)). Those six bridge
methods delegate to functions that live in **two different files**:

| Bridge method | Backing function | Defined in | Loaded by index.html? |
|---|---|---|---|
| `createBlock` | `saveTimeBlock` | `clock.ts` | ✅ yes (`dist/clock.js`) |
| `updateBlock` | `updateTimeBlock` | `clock.ts` | ✅ yes |
| `deleteBlock` | `deleteTimeBlock` | `clock.ts` | ✅ yes |
| `moveBlock` | `moveTimeBlockToDate` | **`schedule.ts`** | ❌ **no** |
| `addSubtask` | `addBlockSubtask` | **`schedule.ts`** | ❌ **no** |
| `deleteSubtask` | `deleteBlockSubtask` | **`schedule.ts`** | ❌ **no** |

`schedule.ts` is **not** in the `<script>` list in [index.html](../index.html#L14-L18) and
**not** in `electron-builder`'s `files` list ([package.json:22-36](../package.json#L22-L36)).
So at runtime those three globals don't exist. The moment a user:

- adds a sub-task to a block,
- deletes a sub-task, or
- reschedules a block to another day

...in the React Schedule view, `window.calderaSchedule.addSubtask(...)` (etc.) calls an
**undefined** function → `ReferenceError` → the action silently fails.

`TaskList` imports all three (`addSubtask`, `deleteSubtask`, `moveBlock`) per fallow's own
importer list, so these paths are reachable from the shipped UI.

### Why the tooling missed it

Fallow even lists `schedule.ts` as "100% dead / unused file" — structurally true (nothing
*imports* it), but it's still *referenced* by name through a `window` bridge. An import-graph
tool can't connect those dots. This is exactly the kind of seam a hybrid migration leaves
behind.

### Recommended fix (clean, consistent with existing code)

**Port the three functions into the React store**, matching the four schedule mutators that
are *already* React-side ([actions.ts:15-87](../src/react/store/actions.ts#L15-L87): 
`toggleBlockCompleted`, `toggleSubtaskCompleted`, `updateBlockTimes`,
`updateBlockTimesBatch`). They are trivial `calData` mutations:

- `addBlockSubtask` / `deleteBlockSubtask` — push/filter `block.subtasks`
  ([schedule.ts:633-663](../src/schedule.ts#L633-L663)).
- `moveTimeBlockToDate` — move a one-off block between day keys
  ([schedule.ts:734-744](../src/schedule.ts#L734-L744)); its own comment says it exists
  *"for the React Schedule view's reschedule action."*

React already has the helpers needed (`findStoredBlock`, `getDayData`, `saveCalData`,
`window.calderaBridge.pushSnapshot()`), so the port is ~25 lines. After porting:

- Change `addSubtask`, `deleteSubtask`, `moveBlock` in
  [actions.ts](../src/react/store/actions.ts) to call the new local implementations instead
  of `window.calderaSchedule`.
- Remove `moveBlock` / `addSubtask` / `deleteSubtask` from the `window.calderaSchedule`
  bridge ([renderer.ts:269-276](../src/renderer.ts#L269-L276)) and from both ambient type
  declarations ([renderer-globals.d.ts:142-149](../src/renderer-globals.d.ts#L142-L149),
  [global.d.ts:23-30](../src/react/global.d.ts#L23-L30)).

**Add a unit test** for the three ported mutators (pure `calData` in → `calData` out, no
DOM), following the existing `test/*.test.ts` pattern and the TDD-lean standard. This is the
"write the failing test first" case.

> Alternative (faster, worse): re-implement `createBlock`/`updateBlock`/`deleteBlock` as
> well and delete `clock.ts`+`schedule.ts`+`window.calderaSchedule` outright (see P1). That
> is the proper end-state but is a bigger change; the port above is the minimum that fixes
> the bug.

---

## P1 — Delete the dead vanilla renderer (the migration's Phase 4)

React owns every view, but the old vanilla implementation is still compiled and (mostly)
still loaded. **These files must be removed as one coordinated change**, because
`tsconfig.renderer.json` compiles them in a *single shared global scope*
([tsconfig.renderer.json](../tsconfig.renderer.json) `include` list) — deleting one file
without stripping its callers from `renderer.ts` will break the renderer build.

### 1a. Fully dead files — safe to delete

- **`src/calendar-grid.ts`** — fallow: "100% dead." Confirmed: not in index.html's scripts,
  not in `build.files`. Its only callers (`renderCalendarGrid`, `renderMonthStrip`) are
  invoked solely from now-dead `renderer.ts` functions. **Delete.**
- **`src/schedule.ts`** — fallow: "100% dead." Confirmed dead once P0 ports its three live
  functions out. The rest (`renderScheduleView`, `renderScheduleTimeline`, reschedule
  banner, timeline resize helpers) drives DOM that no longer exists. **Delete after P0.**

### 1b. `renderer.ts` — split live bridge from dead UI

[renderer.ts](../src/renderer.ts) is 1316 LOC in a confused half-state. Its boot path
`initCalendarApp()` ([renderer.ts:587-595](../src/renderer.ts#L587)) is **load-bearing** and
must stay — it loads/migrates `calData`, runs the shader background, wires undo/redo, and
installs the `window.caldera*` bridges React depends on.

**Keep (live):**
- Skin / palette / block-appearance logic and `window.calderaAppearance`
  ([renderer.ts:256-264](../src/renderer.ts#L256)).
- `window.calderaView`, `window.calderaPrefs`, and the trimmed `window.calderaSchedule`.
- WebGL shader background (`initShaderBackground` / `destroyShaderBackground` / skins /
  low-power detection).
- `initCalendarApp`, `applyCalendarTheme`, `bindCalendarUIEvents` (undo/redo + glass
  light-follow).

**Delete (dead — references DOM/functions that no longer exist):**
- Entire AI settings modal: `openAiSettingsModal`, `syncAiProviderPanel`, `syncAiModePanel`,
  the model-dropdown helpers, `refreshOllamaModels`, `saveAiSettings`, `runAiImport`
  ([renderer.ts:641-1038](../src/renderer.ts#L641)) — targets `#ai-overlay`,
  `#ai-apikey-input`, etc., all removed; AI now lives in
  [src/react/ai/](../src/react/ai/).
- Entire AI date picker: `openAiDatePicker` … `aiDatePickerClear`
  ([renderer.ts:777-913](../src/renderer.ts#L777)).
- AI review modal + URL/keyword lists: `openAiReviewModal`, `renderAiEventList`,
  `addSelectedAiEvents`, `renderAiUrlList`, `renderAiKeywordList`, `getAiConfig`, etc.
- Settings/skin/shader DOM renderers: `openSettingsModal`, `closeSettingsModal`,
  `renderThemeToggle`, `renderSkinGrid`, `renderShaderToggle`, `bindThemeToggleEvents`,
  `bindShaderToggleEvents` — settings now in
  [SettingsModal.tsx](../src/react/settings/SettingsModal.tsx). (Keep the underlying
  `activateSkin`/`setShaderPref` logic the bridges call.)
- Vanilla view/nav: `switchCalendarView`, `changeMonth`, `changeYear`, `stepScheduleDay`,
  `startDayChangeWatcher` ([renderer.ts:1256-1309](../src/renderer.ts#L1256)) — they call
  `renderCalendarGrid` / `renderMonthStrip` / `renderScheduleView` (deleted in 1a) and touch
  `#calendar-wrapper` / `#schedule-view` (removed from index.html).

This strip is what unblocks deleting `calendar-grid.ts` and `schedule.ts` without a compile
error.

### 1c. `src/clock.ts` (old analog clock)

Only `saveTimeBlock` / `updateTimeBlock` / `deleteTimeBlock`
([clock.ts:329-460](../src/clock.ts#L329)) are still reached (via `createBlock`/`updateBlock`
/`deleteBlock` on the bridge). The rest (`buildClockSVG`, `showTimeBlockPopup`,
`updateClockHand`, etc.) is dead and `updateClockHand` even calls the deleted
`renderScheduleView`. Two options:

- **Interim (lower risk):** keep `clock.ts` loaded but delete everything except the three
  mutators and the helpers they need.
- **End-state (cleaner):** port the three mutators into React (P0 "alternative"), then delete
  `clock.ts`, drop `window.calderaSchedule` entirely, and remove `dist/clock.js` from both
  [index.html:16](../index.html#L16) and `build.files`.

Recommend the interim split for *this* commit, end-state as an immediate follow-up.

### 1d. `src/renderer-ui.ts`

Just three script-global helpers (`qId`, `svgEl`, `renderList`). `svgEl` is used only by the
old clock; `renderList` only by old AI lists; `qId` is still used by the live shader path
(`qId('shader-bg')`). After 1b/1c, inline the one remaining `qId('shader-bg')` call and
**delete `renderer-ui.ts`**, or keep it trimmed to just `qId`. Low priority.

### 1e. Config/manifest follow-through (do alongside 1a–1d)

- Remove `src/calendar-grid.ts`, `src/schedule.ts` (and `clock.ts` if going end-state) from
  the `include` array in [tsconfig.renderer.json](../tsconfig.renderer.json).
- If `clock.ts`/`renderer-ui.ts` are deleted, drop their `dist/*.js` entries from
  `build.files` ([package.json:22-36](../package.json#L22-L36)) and their `<script>` tags
  from [index.html](../index.html).

---

## P2 — Trim now-dead exports and de-duplicate type declarations

### 2a. `renderer-data.ts` — dead event mutators

[renderer-data.ts](../src/renderer-data.ts) is **not** dead — it owns `calData` and installs
`window.calderaBridge` ([renderer-data.ts:80-89](../src/renderer-data.ts#L80)), which
[calStore.ts:25](../src/react/store/calStore.ts#L25) reads on every render. **Do not delete
the file.** But its calendar-event mutators are now duplicated by, and superseded by,
[calendarActions.ts](../src/react/store/calendarActions.ts) (this is the bulk of fallow's
"457 duplicated lines"). Once `calendar-grid.ts` and the `renderer.ts` AI code are gone,
these have no live caller and can be removed: `addEventFromPath`, `addEventWithImage`,
`addEmptyEvent`, `removeEvent`, `setFeaturedCalendarEvent`, `saveEventField`,
`assignEventImage`, `removeEventImage`, `getFeaturedEvent`, `pruneEmptyDayEntry`,
`getRecurringBlocksForDate`, `resolveCalendarImageUrl`, `formatDisplayDate`, `formatTime12h`.
**Keep**: `calData`, the bridge, `saveCalendarData`, `migrateCalendarDataFormat`,
`getOrInitDayData`/`getDayData`, snapshot/undo-redo, and `saveCalendarDataAndRefresh` (still
called by the kept clock mutators). Also drop the dead `let` state at
[renderer-data.ts:18-28](../src/renderer-data.ts#L18) (`scheduleViewMode`,
`scheduleTimelineScale`, `clockDragState`, `timelineResizeState`,
`suppressNextTimelineBarClick`, `selectedScheduleBlock`, `aiPendingEvents`,
`timeBlockPopupState`, `rescheduleBlock`, `hoveredClockBlock`, `modalDate`, `pasteCellDate`,
`hoveredGridCell`) once their users are deleted.

### 2b. Genuinely-unused exports (verify, then drop)

From fallow, confirmed worth removing:
- `formatMonthYear` — [util/format.ts:33](../src/react/util/format.ts#L33), no consumer.
- `useCalStore` export — [calStore.ts:13](../src/react/store/calStore.ts#L13); used internally
  but not imported elsewhere, can drop the `export`.
- `addEventWithImage` export — [calendarActions.ts:44](../src/react/store/calendarActions.ts#L44);
  only used internally by `addEventFromPath`/`addEventFromImageBuffer` — drop `export`.
- `updateBlockTimes` — [actions.ts:47](../src/react/store/actions.ts#L47); confirm whether
  `TimelineMode` uses it or only `updateBlockTimesBatch`. If unused, delete; if it was meant
  to back the editor time-fields, wire it. Don't leave it half-connected.
- `buildFetchPrompt` ([ai/model.ts:35](../src/ai/model.ts#L35)) and `renderPage`
  ([ai/renderer.ts:5](../src/ai/renderer.ts#L5)) — confirm against `ai-import.ts`'s actual
  call path before removing; the `src/ai/` module is main-process AI, separate from
  `src/react/ai/`.

### 2c. Unused / duplicated type declarations

- `ScheduleViewMode`, `ScheduleTimelineScale` in [types.ts:10-11](../src/types.ts#L10) — no
  consumer; also collide with differently-defined copies in
  [renderer-globals.d.ts:16-17](../src/renderer-globals.d.ts#L16) (`'daily' | 'schedule'`).
  Delete the dead ones; keep one definition aligned with the React `'daily' | 'timeline'`
  reality.
- The domain types are declared **three** times — [types.ts](../src/types.ts),
  [renderer-globals.d.ts](../src/renderer-globals.d.ts), and
  [global.d.ts](../src/react/global.d.ts) — which is fallow's `renderer-globals.d.ts`↔
  `types.ts` duplication. The triplication is a side effect of the script-world/module-world
  split and the comments acknowledge "keep in sync." It's a maintenance hazard, not a bug.
  **Don't over-engineer a shared types package now** (per the lean-architecture rule); just
  note it, and collapse `renderer-globals.d.ts` into `types.ts` *after* the vanilla renderer
  is fully retired.

---

## P3 — Lower-value items (mostly auto-resolved by P1)

- **Duplication (fallow: 457 lines / 5.7%)** — the large clone groups
  (`selectors.ts`↔`renderer-data.ts`, `calendarActions.ts`↔`renderer-data.ts`,
  `clock.ts`↔`react/schedule/clock.ts`) are all *old-vanilla ↔ new-React* parallel
  implementations. **Deleting the dead vanilla files (P1/P2a) removes almost all of it** with
  no extra refactor. Don't extract "shared" helpers across the two worlds — they're
  deliberately separate during migration and one side is being deleted.
- **The `src/ai/model.ts` internal clones** (`callOllama`/prompt builders,
  [model.ts:160-197](../src/ai/model.ts#L160)) are real same-file duplication and a fair
  small refactor — extract one prompt-builder helper. Independent of the migration; do it
  later.
- **Complexity hotspots** (fallow lists ~90): the flagged React components
  (`DailyMode` 211 LOC, `TimelineMode` 320 LOC, `CalendarView`, `TaskList`) exceed the
  300-line / high-CRAP guidance but are freshly written and untested. Per the auditing
  standard, add tests before refactoring; otherwise leave them — splitting working,
  just-migrated components now adds risk for little gain. Note for a later pass, not a
  pre-commit blocker.

---

## Do NOT touch (fallow false positives)

- **`src/preload.ts`** — fallow flags it "unused file." It is the **Electron preload entry**,
  loaded via `webPreferences.preload` ([main.ts:19](../src/main.ts#L19)) and shipped in
  `build.files`. Deleting it breaks `window.calAPI` and the whole app. **Keep.**
- **`src/renderer-data.ts` "unused exports"** — the file is the live data owner; its bridge is
  consumed through `window.calderaBridge`, invisible to fallow. Trim dead *members* (P2a), do
  not delete the file.
- **`src/main.ts`, `src/ai-import.ts`** — main-process entry points; the "untested risk"
  flags are advisory, not dead code.

---

## Verification (per auditing + testing standards)

Run in order; each step gates the next:

1. `npm run typecheck:react` and `npm run build` — the renderer (`tsconfig.renderer.json`)
   must compile after files are removed from its `include`. A compile error here means a
   `renderer.ts` caller of a deleted function was missed (P1b).
2. `npm test` — existing `test/*.test.ts` plus the **new P0 unit test** for the ported
   subtask/move mutators (happy path + unhappy paths: missing block, empty label, same-day
   move).
3. Live smoke (the established Electron-main + real-data-copy method): in the React Schedule
   view, **add a sub-task, delete a sub-task, reschedule a block to another day** — these must
   now persist with **zero console errors** (the P0 acceptance test). Then exercise calendar
   add/edit, settings, skin switch (shader still paints), and AI import to confirm no bridge
   was cut by mistake.
4. `npx fallow` again — "unused files" should drop to just the real false positives
   (`preload.ts`), and duplication should fall sharply.

## Recommended commit sequencing

1. **Commit 1 (the fix):** P0 — port the three mutators + unit test. Small, reviewable,
   ships the regression fix on its own. *This is the only part that truly must precede the
   migration commit; the rest can follow.*
2. **Commit 2 (the sweep):** P1 — delete `calendar-grid.ts` + `schedule.ts`, strip
   `renderer.ts` dead UI, update `tsconfig.renderer.json` / `index.html` / `build.files`.
   Its own commit, build- and run-verified, per the migration plan's own Phase C guidance
   ("these files are large and interlinked; do it as its own commit").
3. **Commit 3 (the trim):** P2 — dead exports, dead `let` state, unused types.
4. Update [CHANGELOG.md](../CHANGELOG.md) and bump `package.json` version (per the
   "update changelog on significant change" rule). P3 items become later, separate tasks.
