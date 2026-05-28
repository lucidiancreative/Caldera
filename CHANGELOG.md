# Changelog

## [Unreleased]

### Changed
- Reclassified Caldera as proprietary freeware in the project metadata and end-user documentation
- Rewrote the bundled license text to clearly grant no-cost use while keeping redistribution, modification, resale, and relicensing restricted

### Fixed
- Restored local startup by fixing the invalid `package.json` JSON syntax
- `npm start` now launches Electron through a wrapper that clears `ELECTRON_RUN_AS_NODE`, preventing Node-mode startup failures in contaminated shells
- Consolidated schedule block rendering so clock arcs, drag preview, legend chips, and task swatches share one gradient pipeline
- Added palette-slot migration for time blocks so skins re-theme existing schedule blocks consistently instead of persisting mismatched per-skin hex colors
- Unified rounded block geometry and cross-skin block styling so skins now differ by palette treatment rather than shape/opacity behavior
- Fixed schedule block AM/PM assignment so new blocks inherit the active schedule toggle instead of the current real-world time, and added an explicit AM/PM selector in the block popup for correcting older mis-tagged blocks

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
