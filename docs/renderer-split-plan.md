# Plan: Splitting renderer.ts into Modules

## Current State
- `renderer.ts` is ~2800 lines with 25+ logical sections
- Loaded via `<script>` tag (no module system) to avoid CommonJS wrapper issues
- All code shares global scope intentionally

## Proposed Module Structure

### Option A: ES Modules with Bundler (Recommended)
Introduce a bundler (esbuild or Vite) to enable proper ES modules while outputting a single `renderer.js` for the `<script>` tag.

```
src/renderer/
├── index.ts           # Entry point, boot sequence, global state
├── types.ts           # Local interfaces (Skin, BlockOrPartial, etc.)
├── dom.ts             # qId, svgEl, DOM helpers
├── data.ts            # calData access, migration, day helpers
├── calendar-grid.ts   # Grid rendering, cell interactions, hover strips
├── modal.ts           # Day detail modal, event cards, lightbox
├── clock/
│   ├── index.ts       # Schedule view, clock SVG, arc rendering
│   ├── geometry.ts    # arcPath, angle calculations
│   ├── interaction.ts # Drag-to-create, popup, legend
│   └── blocks.ts      # TimeBlock CRUD operations
├── skins/
│   ├── index.ts       # Skin registry, activation
│   ├── shader.ts      # WebGL shader, low-power detection
│   └── palettes.ts    # Color palettes per skin
├── ai-import/
│   ├── settings.ts    # AI settings modal
│   ├── datepicker.ts  # Custom date picker
│   └── review.ts      # Event review modal
└── ui-bindings.ts     # Event listeners, keyboard shortcuts
```

### Option B: Concatenated Build (No Bundler)
Keep files separate during development, concatenate on build. Simpler setup but less flexible.

```
src/renderer/
├── 00-types.ts
├── 01-dom.ts
├── 02-data.ts
├── 03-skins.ts
├── 04-calendar.ts
├── 05-modal.ts
├── 06-clock.ts
├── 07-ai.ts
├── 08-bindings.ts
└── 99-boot.ts
```

Build script concatenates in order → `dist/renderer.js`.

## Migration Steps (Option A)

### Phase 1: Add Bundler
1. Install esbuild: `npm i -D esbuild`
2. Add build script: `"build:renderer": "esbuild src/renderer/index.ts --bundle --outfile=dist/renderer.js"`
3. Update main build script to use new renderer build

### Phase 2: Extract Types & Helpers
1. Move local interfaces to `types.ts`
2. Move `qId`, `svgEl`, `debounce` to `dom.ts`
3. Move data helpers to `data.ts`
4. Update imports in `index.ts`

### Phase 3: Extract Skins & Shader
1. Move palettes to `skins/palettes.ts`
2. Move WebGL shader to `skins/shader.ts`
3. Move skin registry to `skins/index.ts`

### Phase 4: Extract Calendar Grid
1. Move grid rendering to `calendar-grid.ts`
2. Move hover strip logic
3. Move drag/drop handlers

### Phase 5: Extract Clock/Schedule
1. Move clock SVG rendering to `clock/index.ts`
2. Move geometry functions to `clock/geometry.ts`
3. Move drag interaction to `clock/interaction.ts`
4. Move block CRUD to `clock/blocks.ts`

### Phase 6: Extract AI Import
1. Move settings modal to `ai-import/settings.ts`
2. Move date picker to `ai-import/datepicker.ts`
3. Move review modal to `ai-import/review.ts`

### Phase 7: Extract Modals & Bindings
1. Move day detail modal to `modal.ts`
2. Move all UI bindings to `ui-bindings.ts`

## Shared State Handling

Global state (`calData`, `viewYear`, `viewMonth`, etc.) should remain in `index.ts` and be exported. Modules import what they need:

```typescript
// index.ts
export let calData: CalData = { _recurring: [] };
export let viewYear = new Date().getFullYear();

// calendar-grid.ts
import { calData, viewYear, viewMonth } from './index';
```

For mutations, export setter functions rather than direct assignment:

```typescript
// index.ts
export function setCalData(data: CalData) { calData = data; }
```

## Estimated Effort
- Phase 1: 30 min (bundler setup)
- Phase 2-3: 1 hour (types, helpers, skins)
- Phase 4-6: 2-3 hours (major feature extraction)
- Phase 7: 30 min (final cleanup)

**Total: ~5 hours**

## Benefits
- Files under 400 lines each
- Faster IDE navigation and autocomplete
- Easier to test individual modules
- Clear dependency graph
- Can lazy-load AI import module if needed

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Circular imports | Keep state in index.ts, export setters |
| Bundle size increase | esbuild tree-shaking, single output file |
| Build complexity | Single npm script, no config file needed |
