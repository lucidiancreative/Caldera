# Caldera

A lightweight, privacy-first desktop calendar for Windows that treats images as first-class data. Every day on the grid can display a photo, turning the calendar into a visual timeline. Includes a built-in analog clock scheduler for daily time blocking.

Built with Electron and vanilla HTML/CSS/JavaScript — no UI frameworks, no external dependencies.

---

## Core Features

### Visual Calendar Grid

Each calendar cell can display a cover image, giving an at-a-glance visual summary of any month. Days with multiple events show a count badge and optional time label. Hovering over any cell with images triggers an animated scroll strip that cycles through all attached images in a seamless loop, with per-image segment heights calculated from natural aspect ratios to properly handle both portrait and landscape content.

### Multi-Event Day System

Each day supports an unlimited number of events, each with its own image, timestamp, and notes. One event per day can be designated as the **featured** event — its image becomes the cover shown on the calendar grid. Opening any day launches a detail modal with scrollable event cards, inline editing, and event management controls.

### Image Input

Three methods for attaching images to events:

- **Clipboard paste** — copy any image, click a cell, `Ctrl+V`
- **Drag and drop** — drag files directly onto any calendar cell or into the event modal
- **File picker** — browse and select via the Assign button on any event card

Images are copied into a local data directory on attachment. A lightbox viewer is available for full-resolution inspection.

### Analog Clock Scheduler

A tab toggle switches between the calendar grid and an SVG-rendered analog clock face tied to the currently selected day. Time blocks are created by click-dragging arcs on a 12-hour ring. Each block supports a label, which renders as curved text along the arc midline using SVG `<textPath>` elements. Labels are auto-truncated when the arc span is too narrow. Blocks are color-coded and listed in a legend strip below the clock for quick editing and deletion.

### Dark Mode

A dark theme is toggled from the titlebar and persisted to `localStorage` between sessions.

### Local-Only Storage

All data — event entries, images, preferences — is stored in the user's local app data directory. Nothing is transmitted externally. No accounts, no cloud sync, no telemetry.

---

## Controls

| Action | Input |
|---|---|
| Open a day | Click any calendar cell |
| Add image (clipboard) | Copy image → click cell → `Ctrl+V` |
| Add image (drag & drop) | Drag file onto cell or modal |
| Add image (file picker) | Click **Assign** on event card |
| Add event | Click **+ Add Event** in the day modal |
| Set cover image | Click the ★ on an event card |
| Navigate months | Click month tabs or `‹` / `›` arrows |
| Navigate years | Click `«` / `»` arrows |
| Toggle dark mode | Click the moon/sun icon in the titlebar |
| Toggle clock view | Click the clock tab |
| Create time block | Click-drag an arc on the clock face |

---

## System Requirements

| | |
|---|---|
| **OS** | Windows 10+ (64-bit) |
| **Disk** | ~150 MB |
| **RAM** | ~120 MB at runtime |

---

## Tech Stack

- **Runtime:** [Electron](https://www.electronjs.org/)
- **UI:** Vanilla HTML, CSS, JavaScript (zero framework dependencies)
- **Clock renderer:** Inline SVG with computed arc geometry and `<textPath>` labels
- **Animations:** CSS keyframe-driven scroll strips with per-image segment sizing
- **Data persistence:** JSON flat file + local image directory via Electron IPC

---

## Installation

Download and run `Caldera.exe` — no installation required. On first launch, Windows SmartScreen may prompt since the binary is unsigned; click **More info → Run anyway**.

---

## License

MIT
