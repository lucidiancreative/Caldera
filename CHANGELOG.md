# Changelog

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
