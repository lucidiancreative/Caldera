# Clean Schedule Implementation Plan

## Baseline Assumption

This plan assumes the next implementation starts from the original branch before the `frappe-gantt` work.

This is not a redesign plan for the current spike branch.
This is a clean implementation plan for the next attempt.

The previous `frappe-gantt` branch is treated only as research.

## Product Goal

Build one unified `Schedule` page with:

- one shared task list on the left
- one shared scheduling data model underneath
- one right-side canvas that can switch between two modes:
  - `Daily` mode: the clock-based day view
  - `Schedule` mode: a native timeline / Gantt-style view

Both modes should show the same underlying one-off schedule blocks.
The user should feel like they are switching views, not switching systems.

## Core Product Rules

## 1. One schedule system

There should be no separate task model for normal one-off scheduling in v1.

One-off schedule blocks are the source of truth.

That means:

- creating a block in `Daily` mode makes it appear in `Schedule` mode
- editing a block in `Schedule` mode updates `Daily` mode
- deleting a block in either mode removes it from both

## 2. One Schedule page

There should not be a separate top-level `Gantt` tab.

The top-level app tab remains `Schedule`.

Inside that page, the right-side schedule canvas gets a mode toggle.

## 3. One shared task list

The left task list belongs to the Schedule page as a whole, not to just one mode.

The task list should remain visible and stable while the user switches between:

- `Daily`
- `Schedule`

## 4. First-party timeline renderer

The next implementation should not use `frappe-gantt`.

The timeline should be built as native Caldera UI so that:

- skin/theme styling is fully controlled by the app
- horizontal and vertical scrolling are fully controlled by the app
- timeline behavior matches Caldera scheduling rules
- future editing features can be added without library constraints

## What We Learned From the Spike

The last branch gave us useful product answers:

- the timeline belongs inside the Schedule page
- the task list should stay shared
- the day-scale timeline is required
- the app should own its own scrolling behavior
- the app should own its own theming behavior
- duplicating a separate Gantt task system for one-off scheduling creates avoidable sync complexity

Those lessons should inform the clean implementation, but no spike code should be treated as the starting architecture.

## UX Model

## Schedule page layout

Use the current general Schedule split layout as the conceptual base:

- left rail: consolidated task list
- right panel: schedule canvas

Right-panel header should include:

- mode toggle
- date navigation
- `Today` button
- scale controls when in timeline mode

## Mode naming

Requested naming:

- page: `Schedule`
- mode 1: `Daily`
- mode 2: `Schedule`

This can work, but it creates a naming collision because the page and one sub-mode share the same label.

Recommended cleaner naming:

- page: `Schedule`
- modes: `Daily` and `Timeline`

If the product keeps the requested names, the UI must make the hierarchy extremely clear.

## Daily mode

Daily mode is the clock-based view.

It should preserve the current strengths of Caldera:

- analog time block creation
- AM/PM structure
- task list coordination
- completion handling
- rescheduling behavior

## Schedule mode

Schedule mode is the timeline view.

It should be a native Caldera timeline surface with:

- time-based horizontal axis
- stacked task bars
- day-scale view for hour-by-hour planning
- week-scale view for broader planning
- future room for more advanced planner behavior

## Timeline Requirements

## Required v1 scales

- `Day`
- `Week`

## Optional later scale

- `Month`

## Day scale requirements

The day-scale timeline is mandatory in the next implementation.

It should show hour-based labels such as:

- `12 AM`
- `1 AM`
- `2 AM`
- ...
- `12 PM`
- ...
- `11 PM`

This is what allows a schedule block to transfer cleanly between:

- clock view
- timeline view

## Week scale requirements

The week-scale timeline should:

- show multiple days horizontally
- keep bars aligned to real time positions within each day
- allow the user to understand workload beyond one day without switching mental models

## Architecture

## 1. Shared page state

Add schedule-page state for:

- current schedule date
- current schedule mode
- current timeline scale
- currently focused task or block

Example state shape:

- `scheduleDate`
- `scheduleViewMode = 'daily' | 'timeline'`
- `timelineScale = 'day' | 'week'`
- `focusedBlockId`

## 2. Shared scheduling selectors

Create a small shared view-model layer for one-off schedule blocks.

This layer should provide:

- block lookup by date
- sorted visible block lists
- block-to-task-list mapping
- block-to-timeline-bar mapping
- completion and overdue metadata
- appearance resolution from stored palette/skin info

Both `Daily` and timeline mode should consume this shared layer.

## 3. Shared task list renderer

The left task list should render from the shared scheduling selectors, not from the clock renderer.

The list should be mode-agnostic.

It should support:

- display of all visible schedule blocks for the active context
- completion state
- color swatch
- focus/select behavior
- actions that still make sense across both modes

## 4. Separate view renderers under one page shell

The Schedule page should be structured as:

- schedule shell
- shared task list
- daily renderer
- timeline renderer
- shared schedule actions

This can still live in the current renderer architecture, but the responsibilities should be cleanly separated before new UI complexity is added.

## 5. Native timeline renderer

Build the timeline without a third-party chart package.

Recommended structure:

- timeline shell
- scrollable timeline viewport
- sticky or pinned header
- CSS grid or positioned columns for time slots
- relative bar layer for schedule bars
- optional SVG overlay later for connectors or drag previews

## 6. App-owned scrolling

The timeline scroller must be explicitly implemented by Caldera.

Required behavior:

- real horizontal scrolling
- stable overflow behavior
- `Today` jump behavior
- scroll retention after rerender
- clear separation between vertical task-list scrolling and horizontal timeline scrolling

Nice-to-have behavior:

- shift-wheel horizontal scroll
- drag-to-pan

## 7. Skin-aware visual system

The timeline should be styled from Caldera's skin and theme tokens from day one.

This includes:

- page shell
- task list cards
- timeline header
- grid lines
- bars
- empty states
- buttons
- scrollbars
- focused and selected states

The implementation should not rely on light/dark-only overrides.
It should be built against the same skin/theming primitives as the rest of the app.

## Data Model

## v1 source of truth

Use existing one-off schedule blocks as the only source of truth for this feature.

For clean implementation v1:

- no separate persisted Gantt task record for normal one-off blocks
- no mirror-sync layer between two persisted systems
- no adapter that tries to keep duplicate scheduling entities aligned

## Recurring blocks

Recurring blocks should stay in their current model initially.

Recommended rollout:

1. get one-off blocks working perfectly in both modes
2. add recurring rendering support after the architecture is stable

This keeps v1 focused and reduces failure risk.

## Implementation Phases

## Phase 0: Clean branch start

1. return to the original branch before the `frappe-gantt` work
2. create a fresh feature branch
3. implement from this plan only

## Phase 1: Schedule page shell

1. update the Schedule page header to support mode switching
2. keep the left task list persistent
3. define `Daily` and timeline-mode shells
4. keep the current clock view working inside the new shell

## Phase 2: Shared schedule view model

1. extract shared scheduling selectors/helpers
2. make the task list render from shared state
3. remove any assumption that only the clock view owns schedule rendering

## Phase 3: Timeline v1 surface

1. build the day-scale timeline grid
2. add hourly labels
3. render one-off blocks as positioned bars
4. implement horizontal scroll behavior
5. add `Today` and date navigation behavior

## Phase 4: Week scale

1. add week timeline scale
2. keep bar positioning consistent with real time
3. ensure task list behavior stays unchanged when switching scale

## Phase 5: Interaction parity

1. selecting a task focuses it in both modes
2. clicking a bar opens the shared block editing flow
3. date navigation stays coherent across both modes

## Phase 6: Editing upgrades

1. drag bars to move time
2. resize bars to change duration
3. snap edits to schedule increments such as 15 minutes

## Out of Scope for the clean implementation

- standalone Gantt tab
- `frappe-gantt`
- separate persisted Gantt task system for one-off scheduling
- dependency lines in v1
- multi-day project task entities in v1
- full recurring parity in the first pass

## Acceptance Criteria

The clean implementation is successful when:

1. the `Schedule` page contains both `Daily` and timeline modes
2. the left task list is shared across both modes
3. one-off schedule blocks appear consistently in both modes
4. switching modes does not create duplicate scheduling records
5. timeline horizontal scrolling works reliably
6. theme and skin styling look native and consistent
7. the day-scale timeline clearly shows hour-based labels and aligned task bars

## Recommended Build Order

Build the next implementation in this order:

1. schedule shell and mode toggle
2. shared task list architecture
3. shared schedule selectors
4. day-scale timeline rendering
5. scrolling and navigation
6. week scale
7. editing parity

## Final Direction

The next attempt should be treated as a fresh implementation of a unified Schedule page.

The goal is not to salvage the `frappe-gantt` work.
The goal is to build the right architecture cleanly:

- one page
- one task list
- one scheduling system
- two views
- app-owned theming
- app-owned scrolling
