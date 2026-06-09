# Caldera React Migration Plan

## Status

Active plan. Supersedes the framing in `docs/schedule-gantt-redesign-plan.md`.

That earlier doc assumed a vanilla, no-framework reimplementation and has been retired. Its
**product/UX rules still hold** and are carried forward below as requirements. Only its
*implementation* assumptions (build it native, no framework) are replaced by this plan.

### Product/UX requirements (carried over from the retired gantt plan)

- **One Schedule page, two modes.** No separate top-level Gantt tab. The page hosts a mode
  toggle on the right-side canvas.
- **Recommended mode naming:** page = `Schedule`, modes = `Daily` and `Timeline` (avoid the
  `Schedule`/`Schedule` label collision the current UI has).
- **One shared task list** on the left, stable and visible across both modes, rendered from
  shared selectors — not owned by the clock renderer.
- **One scheduling source of truth.** One-off schedule blocks are it; no second persisted
  task system, no mirror-sync layer. Creating/editing/deleting in one mode reflects in both.
- **Daily mode** preserves Caldera's current strengths: analog block creation, AM/PM
  structure, task coordination, completion handling, rescheduling.
- **Timeline mode** scales: `Day` (mandatory v1) and `Week` (v1); `Month` later. Hour labels
  `12 AM … 11 PM`; bars aligned to real time positions so a block transfers cleanly between
  clock and timeline.
- **App-owned scrolling and theming** for the timeline (real horizontal scroll, Today jump,
  scroll retention, skin/theme tokens from day one).

## Decision

Migrate the Caldera **renderer** from vanilla script-tag TypeScript to **React + Vite**,
with **Zustand** as the single state store. The Electron main and preload processes are
**not** changed.

This is the industry-standard stack for a modern Electron renderer (Vite for the renderer
bundle, React for declarative UI, a minimal store for shared state). No significant
deviation from standard practice is being made. The one deliberately lean choice —
Zustand instead of Redux/Context — is justified below.

## Why migrate at all

The renderer is functionally fine; the problem is the **render model**. Every interaction
in the Schedule view calls `renderScheduleView()` (`src/schedule.ts`), which does
`innerHTML = ''` and rebuilds the clock, timeline, task list, and details panel from
scratch, re-binding every listener. The symptoms of fighting that model are already in the
code:

- manual `scrollLeft` save/restore across rebuilds (`src/schedule.ts`)
- `suppressNextTimelineBarClick` to paper over click/drag races from re-created DOM
- whole-page re-render on a single task toggle or subtask edit

A declarative framework makes "update only what changed" the default, which structurally
removes this class of jank. React was chosen by the maintainer for familiarity and
ecosystem; this plan's job is to get React's benefits **without** re-introducing jank or
heavy abstraction.

## Anti-jank strategy (non-negotiable core)

React's failure mode is re-rendering whole trees on every state change — which would
recreate the current jank. Three disciplines prevent that and keep the code flat and
greppable:

1. **Zustand store with selective subscriptions — not React Context.**
   Context re-renders *every* consumer on any change. Components instead subscribe to the
   exact slice they need, e.g. `useStore(s => s.blocksFor(date))`. Dragging one bar
   re-renders one bar, not the page. This is what gives React fine-grained-update behavior.

2. **Keyed lists + component-local state.**
   Each timeline bar and task row is its own keyed component owning its hover/drag state.
   React reconciles instead of rebuilding, so the scroll container persists — the
   `scrollLeft` and `suppressNextTimelineBarClick` hacks are deleted, not ported.

3. **No blanket `useMemo`/`useCallback`.**
   With store selectors doing the work, memoization is added only where a profiler shows a
   need. Keeps the code aligned with the "no over-engineering" rule.

If these three hold, React performs like a fine-grained reactive framework for our use case.

## Architecture

### 1. Store as the single source of truth (service layer)

`calData` becomes owned by a Zustand store. The store is the **only** thing that talks to
`window.calAPI` (load/save/image IPC), giving us the clean service layer the architecture
standard asks for. UI never calls IPC directly.

```
src/store/calStore.ts      // calData state + actions (load, mutate, persist via calAPI)
src/store/selectors.ts     // blocksFor(date), tasksFor(date), overdue/completion meta
```

Main and preload (`src/main.ts`, `src/preload.ts`) are untouched. The `window.calAPI`
bridge contract stays identical.

### 2. The hybrid bridge (a real toggle, not commented code)

During migration, React (Schedule) and vanilla (Calendar grid) share `calData`. Keep them
in sync with one explicit subscription:

```
calStore.subscribe(renderCalendarGrid);   // legacy calendar repaints on store change
```

This is a deliberate, documented transition seam. It is **deleted** the moment the calendar
grid is ported to React. No long-lived dual-write system.

### 3. Component tree (target for the Schedule page)

```
SchedulePage
├── ScheduleHeader        (date nav, Today, mode toggle, scale controls)
├── TaskList              (shared across modes; reads selectors)
├── DailyMode
│   └── ClockSVG          (analog ring, block arcs, drag-to-create)
├── TimelineMode
│   ├── TimelineHeader    (sticky hour labels)
│   └── TimelineBars      (keyed bars + boundary handles)
└── BlockDetailsPanel     (selected block + subtasks)
```

### 4. Build & tooling

- **Vite** builds the renderer (`index.html` becomes the Vite entry; bundles React + store).
- **tsc** continues to build main/preload via `tsconfig.main.json` (no change to that path).
- `package.json` scripts updated: `dev` (vite), `build` (vite build + tsc main), `dist`
  unchanged conceptually but pointed at Vite output.
- `electron-builder` `files` list updated to ship the Vite `dist` bundle instead of the
  individual `dist/*.js` script files.
- Alternative considered: `electron-vite` (all-in-one for main+preload+renderer). Rejected
  for now to avoid disturbing the working main/preload tsc pipeline — lean, incremental.

### 5. Theming

React components consume the existing CSS variables and skin classes in `styles.css`
directly (className-based, no CSS-in-JS, no design-token layer) — consistent with the
Level-1-variables-only rule. No styling system is introduced.

## Phased plan

### Phase 0 — Tooling
1. Add `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `zustand`.
2. Convert `index.html` to a Vite entry that mounts a React root.
3. Wire Vite output into the Electron load path and `electron-builder` `files`.
4. Verify the app still launches with an empty React root beside the existing views.

### Phase 1 — Store
1. Port `calData` load/save/mutation logic from `src/renderer-data.ts` into `calStore.ts`,
   persisting through `window.calAPI`.
2. Add `selectors.ts` for block/task/overdue/completion derivations.
3. Add `calStore.subscribe(renderCalendarGrid)` bridge so the vanilla calendar still works.

### Phase 2 — Schedule view in React (the proof)
1. Build `SchedulePage` shell + shared `TaskList` from selectors.
2. Build `TimelineMode` (keyed bars, boundary-handle resize, native horizontal scroll).
3. Build `BlockDetailsPanel` + subtasks.
4. Build `DailyMode` / `ClockSVG` last (SVG-in-React + pointer math is the fiddliest part).
5. Fix the two non-jank issues here while rebuilding: timeline visual coherence with the
   rest of the app, and the incomplete task/sub-task model.
6. **Decision gate:** if this feels smooth and maintainable, continue; if not, reassess.

### Phase 3 — Port remaining surfaces
Port one island at a time, deleting the bridge as each lands:
1. Calendar grid (`src/calendar-grid.ts`) → remove the legacy bridge.
2. Day-detail modal, lightbox.
3. Settings / theme / skin modal.
4. AI import modal (`src/ai-import.ts` stays as the IPC entrypoint; only its UI moves).

### Phase 4 — Cleanup
1. Remove dead vanilla renderer modules and the `vendor/frappe-gantt/` folder.
2. Collapse `tsconfig.renderer.json` and the per-script `files` entries.
3. Update `README.md` build/run docs and `CHANGELOG.md`; bump `package.json` version.

## Risks and tricky parts

- **Shared `calData` boundary** during the hybrid window — mitigated by the store + single
  bridge. This is the highest-risk seam; keep the hybrid window short.
- **SVG clock port** — analog ring, arc math, and drag-to-create are the densest existing
  logic (`src/clock.ts`). Port last in Phase 2, after simpler surfaces validate the pattern.
- **Drag/resize interactions** — must move from document-level mouse listeners to React
  pointer handlers + store updates without reintroducing the click/drag race.
- **Packaging** — `electron-builder` must ship the bundled Vite output; verify a real
  `dist:win` build, not just `npm run dev`.

## Observability (kept lean)

Not building enterprise telemetry. Minimum: keep the existing `try/catch` + `console.error`
around persistence, and ensure store actions that hit `calAPI` log failures. Crash reporting
can be added later if the app is distributed more widely — noted, not scoped here.

## Acceptance criteria

1. Schedule view runs in React with no full-page rebuilds on interaction.
2. Selecting a task, toggling completion, editing a subtask, or dragging a bar updates only
   the affected element; scroll position and focus are preserved with no manual juggling.
3. One-off blocks appear consistently in Daily and Timeline modes from one shared store.
4. The vanilla calendar grid stays correct during the hybrid window via the bridge.
5. Theme/skin styling looks native (existing CSS variables, no new token system).
6. A packaged `dist:win` build launches and persists data correctly.

## Out of scope (this plan)

- Standalone Gantt tab; `frappe-gantt` (already removed).
- A second persisted task system for one-off blocks — store stays single-source.
- Dependency lines / multi-day project tasks.
- Full recurring-block parity in the first Schedule pass (add after architecture is stable).
- Redux, CSS-in-JS, design-token systems, or any abstraction beyond the store.

## Recommended build order

1. Vite + React shell (Phase 0)
2. Store + bridge (Phase 1)
3. Schedule task list and timeline (Phase 2.1–2.3)
4. Clock SVG (Phase 2.4)
5. Decision gate
6. Calendar grid, modals, settings, AI (Phase 3)
7. Cleanup and packaging verification (Phase 4)
