# Schedule (React) — Parity & Polish Fixes Plan

## Status

Completed on June 10, 2026. The parity issues called out in the self-critique were
addressed during the final migration pass, including timeline resizing, live appearance
sync, React-owned schedule routing, and retirement of the shipped legacy schedule shell.

## Goal

Close the real regressions from the vanilla→React Schedule migration, fix the small
correctness/polish defects, and retire the now-dead vanilla schedule code — without
disturbing the rest of the app. No new dependencies; reuse existing patterns and styles.

## Phases (priority order)

---

## Phase A — Restore block-time editing (parity-critical) — issue #1

**Problem:** The React timeline has no resize handles, and the editor has no time fields,
so an existing block's start/end **cannot be changed** in React. (Vanilla edited times
only via timeline boundary drags.)

**Industry-standard approach:** direct manipulation — draggable edge handles on the
timeline bar (the expected Gantt/timeline interaction).

**Primary fix — timeline resize handles:**
1. Add a pure helper `absoluteMinutesToBlockTimes(startAbs, endAbs)` → `{ ampm, startMin,
   endMin }` (port of the vanilla `applyAbsoluteMinutesToTimeBlock` math). Unit-test it
   (wrap/clamp/min-duration cases).
2. In `src/react/schedule/TimelineMode.tsx`, render a thin left and right handle on each
   bar (reuse a `.rtimeline-handle` class). Pointer-drag updates that edge:
   - map pointer X → absolute minutes via the existing `hourWidth` (`(offsetX/hourWidth)*60`),
     snap to 15, clamp to `0..1440`, enforce a 15-min minimum duration;
   - convert back with `absoluteMinutesToBlockTimes` and commit.
3. Add a React write action `updateBlockTimes(calData, key, id, startMin, endMin, ampm)`
   in `src/react/store/actions.ts` that snapshots, mutates the stored block, and saves
   (same pattern as the completion toggles — times don't touch appearance, so no bridge
   round-trip is needed).
4. Use one-drag-scoped listeners via `AbortController` (see #3) so this can't leak.

**Secondary fix (optional) — editor time fields:** add start/end `<input type="time">`
fields to `BlockEditor.tsx` that convert 24h HH:MM → `{ ampm, startMin, endMin }` and call
`updateBlockTimes` on save. Gives precise editing from either mode; do only if Phase A's
handles feel insufficient.

**Acceptance:** a block's start and end can be changed on the timeline by dragging its
edges; the change persists, re-renders, and stays within 15-min snapping and a 15-min
minimum; the pure converter is unit-tested.

---

## Phase B — Correctness & polish (cheap, high-value)

### #3 — Drag-listener cleanup (correctness)
`DailyMode`'s `onRingMouseDown` (and the new Phase-A resize) add `document` listeners
removed only on mouseup; an unmount mid-drag leaks them. Fix: create an `AbortController`
per drag, pass `{ signal }` to `addEventListener`, and abort any active controller in a
`useEffect(() => () => controllerRef.current?.abort(), [])` cleanup.

### #2 — Stale "past" dimming (correctness)
Only `DailyMode` re-renders on a timer. Add a shared `useMinuteTick()` hook (one
`setInterval(60_000)` returning a counter) and call it in `TaskList`, `TimelineMode`, and
`DailyMode` (replacing Daily's ad-hoc 30s interval) so "past" state updates over time.

### #5 — Editor modal frosted glass (design)
`.rblock-editor-overlay` is a flat scrim; the app's modals use `backdrop-filter: blur(...)`
(design-and-ui.md "Aero Glass"). Add `backdrop-filter: blur(4px)` to the overlay and a
frosted surface treatment to `.rblock-editor`, matching the existing modal styling.

### #6 — Modal covers the titlebar (polish)
The overlay (`inset: 0`) sits over the custom titlebar, blocking window controls. Set the
overlay `top: var(--titlebar-h)` (or lower its z-index below the titlebar) so min/max/close
stay reachable.

### #7 — Shared draft state (UX)
`subtaskDraft` / `rescheduleDate` in `TaskList` are single shared values, so a half-typed
sub-task survives a selection change. Fix: reset `subtaskDraft` when `selectedBlockId`
changes (a small `useEffect`), or move the add-sub-task form into a child component keyed
by block id so its state is naturally per-block.

**Acceptance:** no leaked listeners after unmount; "past" styling refreshes within a
minute; the editor matches the app's frosted modal look and leaves the titlebar usable;
sub-task drafts don't bleed across blocks.

---

## Phase C — Retire the dead vanilla schedule (cleanup) — issues #8, #9

**Problem:** React now owns the Schedule page, but the vanilla schedule renderer still
exists and runs a redundant *hidden* render on every bridge edit (`saveCalendarDataAndRefresh`
→ `renderScheduleView`, guarded by `activeView==='schedule'`).

**Approach:**
1. **Decouple the domain ops from vanilla rendering.** Change the operations the schedule
   bridge calls (`saveTimeBlock`, `updateTimeBlock`, `deleteTimeBlock`, `moveTimeBlockToDate`,
   `addBlockSubtask`, `deleteBlockSubtask`) to persist via `saveCalendarData()` (which
   notifies React) instead of `saveCalendarDataAndRefresh(..., { renderSchedule })`. This
   alone removes the redundant render (#8).
2. **Delete the dead rendering code** once nothing calls it: `renderScheduleView`,
   `renderScheduleTimeline`, the timeline boundary/resize helpers, `buildClockSVG` + clock
   interaction, `renderTaskList`, `renderBlockLegend`, the reschedule-banner flow, and the
   `#schedule-view` markup in `index.html`. **Keep** the domain mutators and their appearance
   helpers (the bridge still needs them) and `clock.ts`'s pure geometry if still referenced.
3. Drop the now-unused `#schedule-view` from the packaged build path and any dead CSS.

**Risk:** these files are large and interlinked; do it as its own commit, build + run after,
and confirm the live Schedule still works with zero console errors. This is the only
higher-risk step — sequence it last.

**Acceptance:** no vanilla schedule render runs on edits; the live React Schedule is
unchanged; build, tests, and a live tab-in/edit smoke all pass with no errors.

---

## Not fixing (accepted) — issue #4

The store uses one `revision` counter, so a data change re-renders the whole schedule
subtree and React's keyed diff absorbs it. This already removes the jank; true per-element
subscriptions would add memoization complexity against the "no over-engineering" rule. We
accept whole-subtree re-render + diff and will only revisit if a profiler shows a problem.
(The earlier "one bar re-renders one bar" description was inaccurate and is corrected here.)

## Testing

- Pure helpers get unit tests (Phase A's `absoluteMinutesToBlockTimes`, plus the
  resize snap/clamp), per the testing standard.
- UI behavior (resize, modal, ticks, cleanup, dead-code removal) is verified by driving the
  real app (the established Electron-main + `executeJavaScript` smoke against a copy of real
  data), since the renderer is not unit-testable in isolation.

## Recommended order

1. Phase A — timeline resize + `updateBlockTimes` (+ unit test)  ← closes the real regression
2. Phase B — #3, #2, #5, #6, #7 (small, independent)
3. Phase C — decouple + delete dead vanilla schedule code (its own commit, run-verified)

## Out of scope

- Phase 3 of the migration (porting calendar grid / modals / settings / AI to React).
- Editor start/end fields are optional (Phase A secondary), not required for parity.
- Any new abstraction beyond the existing store/bridge/selector layers.
