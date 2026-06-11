# Caldera

A lightweight, privacy-first desktop calendar for Windows that treats images as first-class data. Every day on the grid can display a photo, turning the calendar into a visual timeline. Includes a built-in analog clock scheduler for daily time blocking.

---

## Core Features

### Visual Calendar Grid

Each calendar cell can display a cover image, giving an at-a-glance visual summary of any month. Days with multiple events show a count badge and optional time label. Hovering over any cell with images triggers an animated scroll strip that cycles through all attached images in a seamless loop, with per-image segment heights calculated from natural aspect ratios to properly handle both portrait and landscape content.

<img width="1609" height="1377" alt="image" src="https://github.com/user-attachments/assets/4a2c453b-f76a-46cd-8723-6f819ad2951e" />


### Multi-Event Day System

Each day supports an unlimited number of events, each with its own image, timestamp, and notes. One event per day can be designated as the **featured** event — its image becomes the cover shown on the calendar grid. Opening any day launches a detail modal with scrollable event cards, inline editing, and event management controls.

### Image Input

Three methods for attaching images to events:

- **Clipboard paste** — copy any image, click a cell, `Ctrl+V`
- **Drag and drop** — drag files directly onto any calendar cell or into the event modal
- **File picker** — browse and select via the Assign button on any event card

Images are copied into a local data directory on attachment. A lightbox viewer is available for full-resolution inspection.

### Schedule Workspace

A tab toggle switches between the calendar grid and a dedicated Schedule workspace tied to the selected day. The Schedule page includes a shared task list plus two views:

- **Daily**: an SVG-rendered analog clock where time blocks are created by click-dragging arcs on a 12-hour ring
- **Timeline**: a horizontal day timeline with direct bar resizing for adjusting start and end times

Blocks stay in one shared source of truth across both modes, so edits, completion state, sub-tasks, and recurrence changes stay in sync.

<img width="1616" height="1381" alt="image" src="https://github.com/user-attachments/assets/0fbac8d7-8c08-4a02-8504-4ad88841a72d" />


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
| Toggle dark mode | Open Settings from the titlebar gear, then choose Light or Dark |
| Open Schedule view | Click the Schedule tab |
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
- **UI:** React 19 + TypeScript, with shared renderer bridges for local-first Electron data and preferences
- **Clock renderer:** Inline SVG with computed arc geometry and `<textPath>` labels
- **Animations:** CSS keyframe-driven scroll strips with per-image segment sizing
- **Data persistence:** JSON flat file + local image directory via Electron IPC

---

## Installation

Caldera is distributed as proprietary freeware: free to download and use, but not open source.

Download and run `Caldera.exe` — no installation required. On first launch, Windows SmartScreen may prompt since the binary is unsigned; click **More info → Run anyway**.

---

## License

Caldera is proprietary freeware. You may use it at no monetary cost, but you may not modify, redistribute, resell, or relicense it without prior written permission. See [LICENSE](LICENSE) for the full license terms.

