/* ────────────────────────────────────────────────────────
   Caldera – renderer.js
   Multi-event calendar: each day holds an array of events.
   Data shape per day:
     { events: [{ id, image, time, notes }], featuredId }
──────────────────────────────────────────────────────── */

const calBridge = window.calAPI;

// ── State ──────────────────────────────────────────────
let calData         = {};
let viewYear        = new Date().getFullYear();
let viewMonth       = new Date().getMonth();
let modalDate       = null;
let pasteCellDate   = null;
let renderedTodayKey = null;
let hoveredGridCell = null;
let activeView      = 'calendar';
let scheduleDate    = null;
let clockDragState       = null;
let timeBlockPopupState      = null;
let clockAmPm       = new Date().getHours() >= 12 ? 'PM' : 'AM';
let rescheduleBlock = null;
let hoveredClockBlock    = null; // { block, key } – block the cursor is over on the clock face
const undoStack     = [];
const redoStack     = [];
const MAX_HISTORY   = 50;
const BLOCK_COLORS = ['#4f6ef7', '#e03030', '#2eb67d', '#f0a500', '#a259ff', '#ff6b35'];

// ── Boot ───────────────────────────────────────────────
async function initCalendarApp() {
  applyCalendarTheme(localStorage.getItem('theme') === 'dark');
  const raw = await calBridge.loadData();
  calData = migrateCalendarDataFormat(raw);
  renderMonthStrip();
  renderCalendarGrid();
  bindCalendarUIEvents();
}

function applyCalendarTheme(isDarkMode) {
  document.body.classList.toggle('dark', isDarkMode);
  document.getElementById('btn-theme').textContent = isDarkMode ? '\u2600' : '\u263E';
}

// ── Helpers ────────────────────────────────────────────
function generateCalendarEntryId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatDisplayDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function toElectronFileUrl(absPath) {
  return 'file:///' + absPath.replace(/\\/g, '/');
}

function formatTime12h(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Returns today's date key — computed fresh each call so the app
// stays correct if left open past midnight.
function getTodayKey() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

async function saveCalendarData() {
  await calBridge.saveData(calData);
}

function pushCalendarSnapshot() {
  undoStack.push(JSON.stringify(calData));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // any new user action invalidates the redo chain
}

async function applyCalendarSnapshot(snapshot) {
  calData = JSON.parse(snapshot);
  await saveCalendarData();
  renderCalendarGrid();
  renderMonthStrip();
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
  if (modalDate && !document.getElementById('modal-overlay').classList.contains('hidden'))
    renderEventCards(modalDate);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const CELL_HOVER_SCROLL_PX_PER_SEC = 20;

function measureImageNaturalDimensions(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });
}

// ── Migration: old single-event format → new multi-event ──
function migrateCalendarDataFormat(raw) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key === '_recurring') {
      out._recurring = Array.isArray(val) ? val : [];
      continue;
    }
    if (val.events) {
      out[key] = val;
      if (!out[key].timeBlocks) out[key].timeBlocks = [];
      out[key].timeBlocks.forEach(b => {
        if (!b.ampm)             b.ampm      = 'AM';
        if (b.completed == null) b.completed = false;
      });
    } else {
      const id = generateCalendarEntryId();
      out[key] = {
        events:     [{ id, image: val.image || null, notes: val.notes || '', time: val.time || '' }],
        featuredId: val.image ? id : null,
      };
    }
  }
  if (!out._recurring) out._recurring = [];
  return out;
}

// ── Day data helpers ────────────────────────────────────
function getOrInitDayData(key) {
  if (!calData[key]) calData[key] = { events: [], featuredId: null, timeBlocks: [] };
  if (!calData[key].timeBlocks) calData[key].timeBlocks = [];
  return calData[key];
}

function getRecurringBlocksForDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return (calData._recurring || []).filter(b => {
    if (b.excludedDates?.includes(key)) return false;
    if (b.recurrence === 'daily')   return true;
    if (b.recurrence === 'weekly')  return date.getDay() === b.dayOfWeek;
    if (b.recurrence === 'monthly') return d === b.dayOfMonth;
    return false;
  });
}

function getFeaturedEvent(key) {
  const day = calData[key];
  if (!day?.events?.length) return null;
  return day.events.find(e => e.id === day.featuredId) || day.events[0];
}

function pruneEmptyDayEntry(key) {
  const day = calData[key];
  if (!day) return;
  if (!day.events.length) { delete calData[key]; return; }
  if (!day.events.find(e => e.id === day.featuredId)) {
    day.featuredId = day.events[0].id;
  }
}

// ── Strip ──────────────────────────────────────────────
function renderMonthStrip() {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('current-label').textContent = `${months[viewMonth]} ${viewYear}`;
  document.querySelectorAll('.month-tab').forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.month) === viewMonth)
  );
}

// ── Grid ───────────────────────────────────────────────
// Cells are built synchronously first, then all resolveImage calls
// fire in parallel via Promise.all so the grid never waits 31× in series.
async function renderCalendarGrid() {
  hoveredGridCell = null;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const todayKey    = getTodayKey();
  renderedTodayKey  = todayKey;
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'day-cell empty';
    grid.appendChild(blank);
  }

  const imageResolves = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const key  = dateKey(viewYear, viewMonth, d);
    const cell = document.createElement('div');
    cell.className    = 'day-cell';
    cell.dataset.date = key;
    if (key === todayKey) cell.classList.add('today');
    if (key < todayKey)   cell.classList.add('past');

    const dayNum = document.createElement('span');
    dayNum.className = 'day-num';
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    const featured = getFeaturedEvent(key);
    if (featured?.image) {
      cell.classList.add('has-image');
      const bg = document.createElement('div');
      bg.className = 'cell-bg';
      cell.insertBefore(bg, dayNum);
      // Collect resolve promise — all will run concurrently below
      imageResolves.push(
        calBridge.resolveImage(featured.image).then(fullPath => {
          bg.style.backgroundImage = `url("${toElectronFileUrl(fullPath)}")`;
        }).catch(err => console.error(`Failed to resolve featured image for ${key}:`, err))
      );
    }

    const count = calData[key]?.events?.length || 0;
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className   = 'cell-count';
      badge.textContent = count;
      cell.appendChild(badge);
    }

    if (featured?.time) {
      const tb = document.createElement('span');
      tb.className   = 'cell-time';
      tb.textContent = formatTime12h(featured.time);
      cell.appendChild(tb);
    }

    cell.addEventListener('dragenter', onCellDragEnter);
    cell.addEventListener('dragover',  onCellDragOver);
    cell.addEventListener('dragleave', onCellDragLeave);
    cell.addEventListener('drop',      onCalendarCellDrop);
    cell.addEventListener('click', () => {
      scheduleDate = key;
      if (activeView === 'schedule') renderScheduleView(key);
      openDayDetailModal(key);
    });
    cell.addEventListener('mouseenter', () => {
      pasteCellDate = key;
      if (calData[key]?.events?.some(e => e.image)) {
        setupHoverScrollStrip(cell, key).catch(console.error);
      }
    });
    cell.addEventListener('mouseleave', () => {
      pasteCellDate = null;
      teardownHoverScrollStrip(cell);
    });

    grid.appendChild(cell);
  }

  // Resolve all image paths concurrently
  await Promise.all(imageResolves);
}

async function refreshCalendarCell(key) {
  const cell = document.querySelector(`.day-cell[data-date="${key}"]`);
  if (!cell) return;

  // If this cell has an active hover strip, cancel it
  if (hoveredGridCell === cell) hoveredGridCell = null;

  cell.querySelector('.cell-bg')?.remove();
  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.querySelector('.cell-time')?.remove();
  cell.querySelector('.cell-count')?.remove();

  const featured = getFeaturedEvent(key);
  if (featured?.image) {
    cell.classList.add('has-image');
    const fullPath = await calBridge.resolveImage(featured.image);
    const bg = document.createElement('div');
    bg.className = 'cell-bg';
    bg.style.backgroundImage = `url("${toElectronFileUrl(fullPath)}")`;
    cell.insertBefore(bg, cell.querySelector('.day-num'));
  } else {
    cell.classList.remove('has-image');
  }

  const count = calData[key]?.events?.length || 0;
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className   = 'cell-count';
    badge.textContent = count;
    cell.appendChild(badge);
  }

  if (featured?.time) {
    const tb = document.createElement('span');
    tb.className   = 'cell-time';
    tb.textContent = formatTime12h(featured.time);
    cell.appendChild(tb);
  }
}

// ── Hover scroll strip ──────────────────────────────────
// On mouseenter: builds a vertically-scrolling strip over the hovered cell.
// Each segment height = max(cellHeight, cellWidth × imgH/imgW) so portrait
// images scroll through more content at the same px/s rate.
// Cell size is stable during hover, so we measure once — no ResizeObserver needed.
async function setupHoverScrollStrip(cell, key) {
  hoveredGridCell = cell;

  const day = calData[key];
  if (!day?.events?.length) return;

  // All events with images, featured image first
  const withImages = day.events.filter(e => e.image);
  if (!withImages.length) return;
  withImages.sort((a, b) => {
    if (a.id === day.featuredId) return -1;
    if (b.id === day.featuredId) return 1;
    return 0;
  });

  const strip = document.createElement('div');
  strip.className = 'cell-scroll-strip';

  // Resolve all image paths and measure natural dimensions concurrently
  const imageInfo = await Promise.all(
    withImages.map(async ev => {
      const fullPath = await calBridge.resolveImage(ev.image);
      const url      = toElectronFileUrl(fullPath);
      const size     = await measureImageNaturalDimensions(url);
      return { url, size };
    })
  );

  // Bail if the mouse left this cell while images were loading
  if (hoveredGridCell !== cell) return;

  // Each image gets its own segment so the strip can scroll through multiple photos independently
  const segments = imageInfo.map(({ url }) => {
    const seg = document.createElement('div');
    seg.className = 'cell-scroll-segment';
    seg.style.backgroundImage = `url("${url}")`;
    strip.appendChild(seg);
    return seg;
  });

  // Clone of first segment for seamless continuous loop
  const clone = document.createElement('div');
  clone.className = 'cell-scroll-segment';
  clone.style.backgroundImage = `url("${imageInfo[0].url}")`;
  strip.appendChild(clone);

  // Remove any stale strip before inserting (handles rapid re-hover on same cell)
  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.insertBefore(strip, cell.querySelector('.day-num'));

  // Measure cell once — size is stable for the duration of the hover
  const cellH = cell.offsetHeight;
  const cellW = cell.offsetWidth;

  // Segment height = natural image height scaled to cell width,
  // minimum cellH so landscape images still fill the cell.
  const segHeights = imageInfo.map(({ size }) =>
    Math.max(cellH, size.w > 0 ? Math.round(cellW * size.h / size.w) : cellH)
  );

  segments.forEach((seg, i) => { seg.style.height = segHeights[i] + 'px'; });
  clone.style.height = segHeights[0] + 'px';

  const totalTravel = segHeights.reduce((a, b) => a + b, 0);
  const duration    = (totalTravel / CELL_HOVER_SCROLL_PX_PER_SEC).toFixed(2);
  strip.style.setProperty('--scroll-dist', `-${totalTravel}px`);
  strip.style.animation = `cell-strip-scroll ${duration}s linear infinite`;
}

function teardownHoverScrollStrip(cell) {
  hoveredGridCell = null;
  cell.querySelector('.cell-scroll-strip')?.remove();
}

// ── Drag & Drop (cells) ────────────────────────────────
const dragCounters = new WeakMap();

function onCellDragEnter(e) {
  e.preventDefault();
  const cell = e.currentTarget;
  dragCounters.set(cell, (dragCounters.get(cell) || 0) + 1);
  cell.classList.add('drag-over');
}
function onCellDragOver(e) { e.preventDefault(); }
function onCellDragLeave(e) {
  const cell  = e.currentTarget;
  const count = (dragCounters.get(cell) || 1) - 1;
  dragCounters.set(cell, count);
  if (count <= 0) { dragCounters.set(cell, 0); cell.classList.remove('drag-over'); }
}
async function onCalendarCellDrop(e) {
  e.preventDefault();
  const cell = e.currentTarget;
  dragCounters.set(cell, 0);
  cell.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return;

  await addEventFromPath(cell.dataset.date, calBridge.getPathForFile(file));
}

// ── Paste ──────────────────────────────────────────────
document.addEventListener('paste', async (e) => {
  const targetKey = modalDate || pasteCellDate;
  if (!targetKey) return;

  for (const item of (e.clipboardData?.items || [])) {
    if (!item.type.startsWith('image/')) continue;
    const blob = item.getAsFile();
    if (!blob) continue;

    const ext      = item.type === 'image/png' ? '.png' : item.type === 'image/webp' ? '.webp' : '.jpg';
    const id       = generateCalendarEntryId();
    const fileName = `${targetKey}-${id}`;
    const buf      = await blob.arrayBuffer();
    const relPath  = await calBridge.saveImageBuffer(Array.from(new Uint8Array(buf)), fileName, ext);
    await addEventWithImage(targetKey, id, relPath);
    break;
  }
});

// ── Event management ───────────────────────────────────
async function addEventFromPath(key, srcPath) {
  const id       = generateCalendarEntryId();
  const fileName = `${key}-${id}`;
  const relPath  = await calBridge.copyImage(srcPath, fileName);
  await addEventWithImage(key, id, relPath);
}

async function addEventWithImage(key, id, relPath) {
  const day = getOrInitDayData(key);
  day.events.push({ id, image: relPath, notes: '', time: '' });
  // Auto-feature the very first event on a day
  if (!day.featuredId) day.featuredId = id;
  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function addEmptyEvent(key) {
  pushCalendarSnapshot();
  const day = getOrInitDayData(key);
  const id  = generateCalendarEntryId();
  day.events.push({ id, image: null, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await saveCalendarData();
  if (modalDate === key) renderEventCards(key);
}

async function removeEvent(key, eventId) {
  pushCalendarSnapshot();
  const day = calData[key];
  if (!day) return;

  const ev = day.events.find(e => e.id === eventId);
  if (ev?.image) await calBridge.deleteImage(ev.image);

  day.events = day.events.filter(e => e.id !== eventId);
  if (day.featuredId === eventId) day.featuredId = day.events[0]?.id || null;

  pruneEmptyDayEntry(key);
  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function setFeaturedCalendarEvent(key, eventId) {
  pushCalendarSnapshot();
  const day = calData[key];
  if (!day) return;
  day.featuredId = eventId;
  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function saveEventField(key, eventId, field, value) {
  pushCalendarSnapshot();
  const day = calData[key];
  if (!day) return;
  const ev = day.events.find(e => e.id === eventId);
  if (!ev) return;
  if (value) ev[field] = value; else delete ev[field];
  if (field === 'time' && day.featuredId === eventId) await refreshCalendarCell(key);
  await saveCalendarData();
}

async function assignEventImage(key, eventId, srcPath) {
  const day = calData[key];
  const ev  = day?.events.find(e => e.id === eventId);
  if (!ev) return;

  if (ev.image) await calBridge.deleteImage(ev.image);
  const fileName = `${key}-${eventId}`;
  ev.image = await calBridge.copyImage(srcPath, fileName);

  // If the day has no featured image yet, promote this event
  const hasFeaturedImg = day.events.find(e => e.id === day.featuredId)?.image;
  if (!hasFeaturedImg) day.featuredId = eventId;

  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function removeEventImage(key, eventId) {
  const day = calData[key];
  const ev  = day?.events.find(e => e.id === eventId);
  if (!ev?.image) return;

  await calBridge.deleteImage(ev.image);
  ev.image = null;

  // If this was the featured event, find another with an image
  if (day.featuredId === eventId) {
    const other = day.events.find(e => e.id !== eventId && e.image);
    day.featuredId = other?.id || day.events.find(e => e.id !== eventId)?.id || null;
  }

  await saveCalendarData();
  await refreshCalendarCell(key);
  if (modalDate === key) renderEventCards(key);
}

// ── Lightbox ───────────────────────────────────────────
function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox-overlay').classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightbox-overlay').classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
}

// ── Modal ──────────────────────────────────────────────
function openDayDetailModal(key) {
  modalDate = key;
  document.getElementById('modal-date').textContent = formatDisplayDate(key);
  renderEventCards(key);
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeDayDetailModal() {
  modalDate = null;
  document.getElementById('modal-overlay').classList.add('hidden');
}

function renderEventCards(key) {
  const container = document.getElementById('event-cards');
  container.innerHTML = '';

  const day    = calData[key];
  const events = day?.events || [];

  events.forEach(ev => {
    container.appendChild(buildEventCard(key, ev, ev.id === day?.featuredId));
  });

  // Drop zone — always at the bottom of the list
  const zone = document.createElement('div');
  zone.className   = 'modal-add-zone';
  zone.textContent = events.length === 0
    ? 'Drop an image here or click \u201C+ Add Event\u201D to get started'
    : '+ Drop an image here to add another event';

  let zoneCounter = 0;
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    zoneCounter++;
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('dragleave', () => {
    if (--zoneCounter <= 0) { zoneCounter = 0; zone.classList.remove('drag-over'); }
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoneCounter = 0;
    zone.classList.remove('drag-over');
    if (!modalDate) return;
    const file = e.dataTransfer.files[0];
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) return;
    await addEventFromPath(modalDate, calBridge.getPathForFile(file));
  });

  container.appendChild(zone);
}

function buildEventCard(key, ev, isFeatured) {
  const card = document.createElement('div');
  card.className   = 'event-card' + (isFeatured ? ' featured' : '');
  card.dataset.id  = ev.id;

  // ── Toolbar ──────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'card-toolbar';

  const btnCover = document.createElement('button');
  btnCover.className = 'btn-cover';
  btnCover.title     = isFeatured ? 'Calendar cover' : 'Set as calendar cover';
  btnCover.textContent = isFeatured ? '\u2605' : '\u2606'; // ★ / ☆
  if (!isFeatured) btnCover.addEventListener('click', () => setFeaturedCalendarEvent(key, ev.id));

  const coverLabel = document.createElement('span');
  coverLabel.className   = 'cover-label';
  coverLabel.textContent = 'Cover';
  if (!isFeatured) coverLabel.style.display = 'none';

  const spacer = document.createElement('span');
  spacer.className = 'card-spacer';

  const btnAssign = document.createElement('button');
  btnAssign.className   = 'card-action-btn';
  btnAssign.textContent = '\uD83D\uDCF7 Assign';
  btnAssign.title       = 'Assign image via file dialog';
  btnAssign.addEventListener('click', async () => {
    const srcPath = await calBridge.openFileDialog();
    if (srcPath) await assignEventImage(key, ev.id, srcPath);
  });

  const btnRemoveImg = document.createElement('button');
  btnRemoveImg.className   = 'card-action-btn';
  btnRemoveImg.textContent = '\uD83D\uDDD1 Remove';
  btnRemoveImg.title       = 'Remove image';
  btnRemoveImg.style.display = ev.image ? '' : 'none';
  btnRemoveImg.addEventListener('click', () => removeEventImage(key, ev.id));

  const btnDel = document.createElement('button');
  btnDel.className   = 'card-action-btn btn-del-card';
  btnDel.textContent = '\u2715';
  btnDel.title       = 'Delete this event';
  btnDel.addEventListener('click', () => removeEvent(key, ev.id));

  toolbar.append(btnCover, coverLabel, spacer, btnAssign, btnRemoveImg, btnDel);

  // ── Image area ───────────────────────────────────────
  const imgArea = document.createElement('div');
  imgArea.className = 'card-image-area';

  const img = document.createElement('img');
  img.className = 'card-img' + (ev.image ? '' : ' hidden');
  img.alt = '';

  const noImg = document.createElement('div');
  noImg.className   = 'card-no-img';
  noImg.textContent = 'Drop image here or use Assign';
  if (ev.image) noImg.style.display = 'none';

  imgArea.append(img, noImg);

  if (ev.image) {
    imgArea.classList.add('has-image');
    calBridge.resolveImage(ev.image)
      .then(p => { img.src = toElectronFileUrl(p); })
      .catch(err => console.error(`Failed to resolve event image for event ${ev.id}:`, err));
    imgArea.addEventListener('click', () => { if (img.src) openLightbox(img.src); });
  }

  // Drag-drop on card image area → replaces this event's image
  let imgCounter = 0;
  imgArea.addEventListener('dragenter', (e) => {
    e.preventDefault(); e.stopPropagation();
    imgCounter++;
    imgArea.classList.add('drag-over');
  });
  imgArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  imgArea.addEventListener('dragleave', () => {
    if (--imgCounter <= 0) { imgCounter = 0; imgArea.classList.remove('drag-over'); }
  });
  imgArea.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    imgCounter = 0;
    imgArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) return;
    await assignEventImage(key, ev.id, calBridge.getPathForFile(file));
  });

  // ── Fields ───────────────────────────────────────────
  const fields = document.createElement('div');
  fields.className = 'card-fields';

  const timeRow   = document.createElement('div');
  timeRow.className = 'card-time-row';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time';
  const timeInput = document.createElement('input');
  timeInput.type      = 'time';
  timeInput.className = 'card-time';
  timeInput.value     = ev.time || '';
  timeInput.addEventListener('change', () => saveEventField(key, ev.id, 'time', timeInput.value));
  timeRow.append(timeLabel, timeInput);

  const notes = document.createElement('textarea');
  notes.className   = 'card-notes';
  notes.placeholder = 'Notes\u2026';
  notes.value       = ev.notes || '';
  const saveNotes = debounce(() => saveEventField(key, ev.id, 'notes', notes.value.trim()), 400);
  notes.addEventListener('input', saveNotes);

  fields.append(timeRow, notes);
  card.append(toolbar, imgArea, fields);
  return card;
}

// ── UI bindings ────────────────────────────────────────
function bindCalendarUIEvents() {
  document.getElementById('btn-min').addEventListener('click', () => calBridge.winMinimize());
  document.getElementById('btn-max').addEventListener('click', () => calBridge.winMaximize());
  document.getElementById('btn-close').addEventListener('click', () => calBridge.winClose());

  document.getElementById('btn-theme').addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    document.getElementById('btn-theme').textContent = isDark ? '\u2600' : '\u263E';
  });

  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
  document.getElementById('prev-year').addEventListener('click',  () => changeYear(-1));
  document.getElementById('next-year').addEventListener('click',  () => changeYear(1));

  document.querySelectorAll('.month-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMonth = parseInt(btn.dataset.month);
      renderMonthStrip();
      renderCalendarGrid();
      if (activeView !== 'calendar') switchCalendarView('calendar');
    });
  });

  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'schedule') {
        scheduleDate = getTodayKey();
        clockAmPm = new Date().getHours() < 12 ? 'AM' : 'PM';
      }
      switchCalendarView(btn.dataset.view);
    });
  });
  document.getElementById('sched-prev-day').addEventListener('click', () => stepScheduleDay(-1));
  document.getElementById('sched-next-day').addEventListener('click', () => stepScheduleDay(1));

  document.querySelectorAll('.ampm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      clockAmPm = btn.dataset.ampm;
      document.querySelectorAll('.ampm-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.ampm === clockAmPm)
      );
      if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    });
  });
  document.getElementById('reschedule-confirm').addEventListener('click', confirmReschedule);
  document.getElementById('reschedule-cancel').addEventListener('click', cancelReschedule);

  document.getElementById('modal-close').addEventListener('click', closeDayDetailModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeDayDetailModal();
  });

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox-overlay')) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('lightbox-overlay').classList.contains('hidden')) closeLightbox();
      else if (modalDate) closeDayDetailModal();
      else if (rescheduleBlock) cancelReschedule();
      return;
    }

    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    // Backspace over a hovered clock block → delete it
    if (e.key === 'Backspace' && hoveredClockBlock && !inInput) {
      e.preventDefault();
      const { block, key } = hoveredClockBlock;
      hoveredClockBlock = null;
      deleteTimeBlock(key, block.id, block._recurring ? 'all' : undefined);
      return;
    }

    // Ctrl+Z — matches the undo convention users expect from native desktop apps
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey && !inInput) {
      e.preventDefault();
      if (undoStack.length) {
        redoStack.push(JSON.stringify(calData));
        applyCalendarSnapshot(undoStack.pop());
      }
      return;
    }

    // Ctrl+Shift+Z — matches the redo convention; Ctrl+Y intentionally not supported to keep it simple
    if (e.ctrlKey && e.shiftKey && e.key === 'Z' && !inInput) {
      e.preventDefault();
      if (redoStack.length) {
        undoStack.push(JSON.stringify(calData));
        applyCalendarSnapshot(redoStack.pop());
      }
      return;
    }
  });

  document.getElementById('btn-add-event').addEventListener('click', () => {
    if (modalDate) addEmptyEvent(modalDate);
  });

  document.getElementById('btn-schedule-day').addEventListener('click', () => {
    const targetDate = modalDate;
    closeDayDetailModal();
    scheduleDate = targetDate;
    clockAmPm = new Date().getHours() < 12 ? 'AM' : 'PM';
    switchCalendarView('schedule');
  });
}

function changeMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
  renderMonthStrip();
  renderCalendarGrid();
  if (activeView !== 'calendar') switchCalendarView('calendar');
}

function changeYear(delta) {
  viewYear += delta;
  renderMonthStrip();
  renderCalendarGrid();
  if (activeView !== 'calendar') switchCalendarView('calendar');
}

// ── Day-change watcher ─────────────────────────────────
// Polls every 60 s so the today-highlight updates correctly after
// midnight or when the system wakes from sleep.
function startDayChangeWatcher() {
  setInterval(() => {
    if (getTodayKey() !== renderedTodayKey) renderCalendarGrid();
  }, 60_000);
}

// ── View switching ──────────────────────────────────────
function switchCalendarView(view) {
  activeView = view;
  document.getElementById('calendar-wrapper').classList.toggle('hidden', view !== 'calendar');
  document.getElementById('schedule-view').classList.toggle('hidden', view !== 'schedule');
  document.querySelectorAll('.view-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );
  if (view === 'schedule') {
    if (!scheduleDate) scheduleDate = getTodayKey();
    document.querySelectorAll('.ampm-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.ampm === clockAmPm)
    );
    renderScheduleView(scheduleDate);
  }
}

function stepScheduleDay(delta) {
  if (!scheduleDate) scheduleDate = getTodayKey();
  const [y, m, d] = scheduleDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  scheduleDate = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  renderScheduleView(scheduleDate);
}

// ── Schedule / Clock rendering ──────────────────────────
function renderScheduleView(key) {
  scheduleDate = key;
  if (rescheduleBlock && rescheduleBlock._key !== key) rescheduleBlock = null;

  document.getElementById('sched-date-label').textContent = formatDisplayDate(key);
  const area = document.getElementById('clock-area');
  area.innerHTML = '';

  const allDateBlocks = calData[key]?.timeBlocks || [];
  const recurBlocks   = getRecurringBlocksForDate(key).map(b => ({
    ...b,
    completed:  b.completedDates?.includes(key) || false,
    _recurring: true,
  }));
  const allBlocks     = [...allDateBlocks, ...recurBlocks];
  const visibleBlocks = allBlocks.filter(b => b.ampm === clockAmPm);
  // PM clock also renders AM blocks as dimmed overlays — they're always in the past and
  // occupy the same angular positions as their PM counterparts (startMin/endMin are shared
  // 12-hr coordinates). Draw them first so PM blocks layer on top.
  const clockBlocks = clockAmPm === 'PM'
    ? [...allBlocks.filter(b => b.ampm === 'AM').map(b => ({ ...b, _amOverlay: true })),
       ...visibleBlocks]
    : visibleBlocks;
  const svg           = buildClockSVG(key, clockBlocks);
  area.appendChild(svg);
  updateClockHand();

  renderBlockLegend(key, visibleBlocks, svg);
  renderTaskList(key, allBlocks, svg);
  updateRescheduleBanner();
}

function buildClockSVG(key, blocks) {
  const VB = 400, cx = 200, cy = 200, R = 170;
  const r1 = Math.round(R * 0.62);   // inner ring ≈ 105
  const r2 = Math.round(R * 0.85);   // outer ring ≈ 145
  const NS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VB} ${VB}`);

  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  }

  // Defs (for arc label text paths)
  const defs = svgEl('defs', {});
  svg.appendChild(defs);

  // Background circle that defines the clock's visual boundary
  svg.appendChild(svgEl('circle', { class: 'clock-face', cx, cy, r: R }));

  // Hour ticks + numbers (1–11 in loop, 12 separate)
  for (let h = 0; h < 12; h++) {
    const ang      = (h / 12) * 2 * Math.PI - Math.PI / 2;
    const cos      = Math.cos(ang), sin = Math.sin(ang);
    const isMajor  = h % 3 === 0;
    const tickIn   = R * (isMajor ? 0.88 : 0.91);
    const tickOut  = R * 0.975;

    svg.appendChild(svgEl('line', {
      class: isMajor ? 'clock-tick clock-tick-major' : 'clock-tick',
      x1: cx + tickIn * cos,  y1: cy + tickIn * sin,
      x2: cx + tickOut * cos, y2: cy + tickOut * sin,
    }));

    const label = h === 0 ? '12' : String(h);
    const numR  = R * 0.73;
    const txt   = svgEl('text', { class: 'clock-num', x: cx + numR * cos, y: cy + numR * sin });
    txt.textContent = label;
    svg.appendChild(txt);
  }

  // Existing time blocks (drawn below preview + hand)
  blocks.forEach(block => {
    const isRescheduling = rescheduleBlock?.id === block.id;
    const isPast         = isPastBlock(block);

    // Wrap arc + label in a group so opacity/pointer-events apply to both.
    // AM overlays on PM clock get their own class (readable dimmed opacity).
    // Regular past blocks use crossover-arc (near-zero — signals done).
    const dimClass = block._amOverlay ? 'am-overlay-arc'
                   : isPast           ? 'crossover-arc'
                   :                    '';
    const g = svgEl('g', {
      class: [isRescheduling ? 'rescheduling-arc' : '', dimClass].filter(Boolean).join(' '),
    });
    // AM overlays are read-only; am-overlay-arc sets pointer-events:none,
    // but skip attaching handlers entirely to keep things clean
    if (!block._amOverlay) {
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        showTimeBlockPopup('edit', block, key, svg, cx, cy, R);
      });
      g.addEventListener('mouseenter', () => { hoveredClockBlock = { block, key }; });
      g.addEventListener('mouseleave', () => { hoveredClockBlock = null; });
    }

    const path = svgEl('path', {
      class: 'clock-block-arc' + (block._recurring ? ' recurring-arc' : ''),
      d:    arcPath(cx, cy, r1, r2, block.startMin, block.endMin),
      fill: block.color,
    });
    g.appendChild(path);

    // Label follows the arc's curve so text reads naturally inside the block's shape
    const spanMin = (block.endMin - block.startMin + 720) % 720;
    if (spanMin >= 30 && block.label) {
      const rMid    = (r1 + r2) / 2;
      const arcLen  = (spanMin / 720) * 2 * Math.PI * rMid;
      const maxChars = Math.max(1, Math.floor(arcLen / 7));
      const display  = block.label.length > maxChars
        ? block.label.slice(0, maxChars - 1) + '\u2026'
        : block.label;

      const startAng = (block.startMin / 720) * 2 * Math.PI - Math.PI / 2;
      const endAng   = startAng + (spanMin / 720) * 2 * Math.PI;
      const large    = spanMin > 360 ? 1 : 0;
      const lx1 = cx + rMid * Math.cos(startAng), ly1 = cy + rMid * Math.sin(startAng);
      const lx2 = cx + rMid * Math.cos(endAng),   ly2 = cy + rMid * Math.sin(endAng);
      const pathId = `arc-label-path-${block.id}`;

      defs.appendChild(svgEl('path', { id: pathId, d: `M ${lx1} ${ly1} A ${rMid} ${rMid} 0 ${large} 1 ${lx2} ${ly2}` }));

      const tp = svgEl('textPath', { href: `#${pathId}`, startOffset: '50%', 'text-anchor': 'middle' });
      tp.textContent = display;
      const textEl = svgEl('text', { class: 'clock-block-label' });
      textEl.appendChild(tp);
      g.appendChild(textEl);
    }

    svg.appendChild(g);
  });

  // Pre-created path updated during drag so we don't create/destroy SVG nodes on every mousemove
  const preview = svgEl('path', { id: 'clock-preview-arc', class: 'clock-preview', fill: '#888', d: '' });
  svg.appendChild(preview);

  // Drawn above blocks so the hand is always visible regardless of how many arcs are stacked
  const hand = svgEl('line', { id: 'clock-hand', class: 'clock-hand', x1: cx, y1: cy, x2: cx, y2: cy });
  svg.appendChild(hand);

  // Covers the arc endpoints that converge at center, hiding the jagged joins
  svg.appendChild(svgEl('circle', { class: 'clock-hand-dot', cx, cy, r: 5 }));

  bindClockInteraction(svg, cx, cy, r1, r2, key);
  return svg;
}

// ── Clock arc geometry ──────────────────────────────────
function arcPath(cx, cy, r1, r2, startMin, endMin) {
  const spanMin  = (endMin - startMin + 720) % 720;
  if (spanMin === 0) return '';
  const startAng = (startMin / 720) * 2 * Math.PI - Math.PI / 2;
  const endAng   = startAng + (spanMin / 720) * 2 * Math.PI;
  const large    = spanMin > 360 ? 1 : 0;
  const c1 = Math.cos(startAng), s1 = Math.sin(startAng);
  const c2 = Math.cos(endAng),   s2 = Math.sin(endAng);

  const ox1 = cx + r2 * c1, oy1 = cy + r2 * s1;
  const ox2 = cx + r2 * c2, oy2 = cy + r2 * s2;
  const ix1 = cx + r1 * c2, iy1 = cy + r1 * s2;
  const ix2 = cx + r1 * c1, iy2 = cy + r1 * s1;

  return `M ${ox1} ${oy1} A ${r2} ${r2} 0 ${large} 1 ${ox2} ${oy2} ` +
         `L ${ix1} ${iy1} A ${r1} ${r1} 0 ${large} 0 ${ix2} ${iy2} Z`;
}

// Convert screen mouse event to SVG viewBox coordinates
function svgPoint(svg, e) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (400 / rect.width),
    y: (e.clientY - rect.top)  * (400 / rect.height),
  };
}

// Cursor position → 12-hour clock minutes (snapped to 15)
function minutesFromPoint(cx, cy, px, py) {
  const ang = Math.atan2(py - cy, px - cx) + Math.PI / 2;
  const raw = ((ang / (2 * Math.PI)) * 720 + 720) % 720;
  return Math.round(raw / 15) * 15 % 720;
}

// ── Clock drag interaction ──────────────────────────────
function bindClockInteraction(svg, cx, cy, r1, r2, key) {
  svg.addEventListener('mousedown', (e) => {
    if (timeBlockPopupState) return;
    const pt   = svgPoint(svg, e);
    const dist = Math.hypot(pt.x - cx, pt.y - cy);
    if (dist < r1 - 10 || dist > r2 + 10) return;

    const startMin     = minutesFromPoint(cx, cy, pt.x, pt.y);
    const previewPath  = document.getElementById('clock-preview-arc');
    const previewColor = BLOCK_COLORS[(calData[key]?.timeBlocks?.length || 0) % BLOCK_COLORS.length];
    previewPath.setAttribute('fill', previewColor);

    let lastMin = startMin;

    function onClockDragMove(ev) {
      const pt2 = svgPoint(svg, ev);
      lastMin   = minutesFromPoint(cx, cy, pt2.x, pt2.y);
      const span = (lastMin - startMin + 720) % 720;
      previewPath.setAttribute('d', span >= 15 ? arcPath(cx, cy, r1, r2, startMin, lastMin) : '');
    }

    function onClockDragEnd() {
      document.removeEventListener('mousemove', onClockDragMove);
      document.removeEventListener('mouseup', onClockDragEnd);
      previewPath.setAttribute('d', '');
      clockDragState = null;

      const endMin = lastMin;
      const span   = (endMin - startMin + 720) % 720;
      if (span < 15) return;
      showTimeBlockPopup('new', { startMin, endMin }, key, svg, cx, cy, 170);
    }

    clockDragState = { startMin, svg };
    document.addEventListener('mousemove', onClockDragMove);
    document.addEventListener('mouseup', onClockDragEnd);
    e.preventDefault();
  });
}

// ── Block popup ─────────────────────────────────────────
function showTimeBlockPopup(mode, blockOrData, key, svg, cx, cy, R) {
  const popup          = document.getElementById('block-label-popup');
  const input          = document.getElementById('block-label-input');
  const confirmBtn     = document.getElementById('block-label-confirm');
  const delBtn         = document.getElementById('block-label-del');
  const recurSel       = document.getElementById('block-recurrence-select');
  const scopeRow       = document.getElementById('block-scope-row');
  const { startMin, endMin, id, label } = blockOrData;
  const isRecurring    = !!blockOrData._recurring;

  timeBlockPopupState = { mode, key, startMin, endMin, id };
  input.value    = label || '';
  recurSel.value = isRecurring ? (blockOrData.recurrence || 'daily') : 'none';

  // Scope row: visible only when editing an existing recurring block
  if (mode === 'edit' && isRecurring) {
    scopeRow.classList.remove('hidden');
    scopeRow.querySelector('input[value="all"]').checked = true;
  } else {
    scopeRow.classList.add('hidden');
  }

  // Position near arc midpoint (SVG → screen)
  const spanMin = (endMin - startMin + 720) % 720;
  const midMin  = (startMin + spanMin / 2) % 720;
  const ang     = (midMin / 720) * 2 * Math.PI - Math.PI / 2;
  const r       = (R * 0.62 + R * 0.85) / 2;
  const rect    = svg.getBoundingClientRect();
  const sx      = rect.left + (cx + r * Math.cos(ang)) * (rect.width  / 400);
  const sy      = rect.top  + (cy + r * Math.sin(ang)) * (rect.height / 400);

  popup.style.left = Math.min(sx - 10,  window.innerWidth  - 260) + 'px';
  popup.style.top  = Math.min(sy - 20,  window.innerHeight - 180) + 'px';
  delBtn.title = mode === 'new' ? 'Cancel' : 'Delete block';

  popup.classList.remove('hidden');
  input.focus();

  function getSelectedBlockScope() {
    return scopeRow.querySelector('input[name="block-scope"]:checked')?.value || 'all';
  }

  function commitBlockEdit() {
    const lbl        = input.value.trim();
    const recurrence = recurSel.value;
    const scope      = getSelectedBlockScope();
    closeTimeBlockPopup();
    if (!lbl) {
      if (mode === 'edit' && id) deleteTimeBlock(key, id, isRecurring ? scope : undefined);
      return;
    }
    if (mode === 'new') {
      saveTimeBlock(key, { startMin, endMin, label: lbl }, recurrence);
    } else if (mode === 'edit' && id) {
      updateTimeBlock(key, id, lbl, recurrence, scope);
    }
  }

  function onBlockLabelKeyDown(ev) {
    if (ev.key === 'Enter')  { ev.preventDefault(); commitBlockEdit(); }
    if (ev.key === 'Escape') { closeTimeBlockPopup(); }
  }
  // Delay blur so the delete-button click fires first;
  // only commit if focus has moved outside the popup entirely (not to the select/radios inside it)
  function onBlockLabelBlur() { setTimeout(() => { if (timeBlockPopupState && !popup.contains(document.activeElement)) commitBlockEdit(); }, 150); }
  function onBlockDeleteClick()  {
    const scope = getSelectedBlockScope();
    closeTimeBlockPopup();
    if (mode === 'edit' && id) deleteTimeBlock(key, id, isRecurring ? scope : undefined);
  }

  input.addEventListener('keydown',    onBlockLabelKeyDown);
  input.addEventListener('blur',       onBlockLabelBlur);
  confirmBtn.addEventListener('click', commitBlockEdit);
  delBtn.addEventListener('click',     onBlockDeleteClick);

  // When recurrence select changes, show/hide scope row accordingly
  function onBlockRecurrenceChange() {
    if (mode === 'edit' && isRecurring) {
      // scope row stays visible regardless (block is already recurring)
    } else {
      // for new blocks or non-recurring edits, no scope needed
      scopeRow.classList.add('hidden');
    }
  }
  recurSel.addEventListener('change', onBlockRecurrenceChange);

  timeBlockPopupState._cleanup = () => {
    input.removeEventListener('keydown',    onBlockLabelKeyDown);
    input.removeEventListener('blur',       onBlockLabelBlur);
    confirmBtn.removeEventListener('click', commitBlockEdit);
    delBtn.removeEventListener('click',     onBlockDeleteClick);
    recurSel.removeEventListener('change',  onBlockRecurrenceChange);
  };
}

function closeTimeBlockPopup() {
  const popup = document.getElementById('block-label-popup');
  popup.classList.add('hidden');
  if (timeBlockPopupState?._cleanup) timeBlockPopupState._cleanup();
  timeBlockPopupState = null;
}

// ── Time block data operations ──────────────────────────
async function saveTimeBlock(key, { startMin, endMin, label }, recurrence = 'none') {
  pushCalendarSnapshot();
  const ampm = inferBlockAmPm(startMin);
  if (recurrence === 'none') {
    const day   = getOrInitDayData(key);
    const color = BLOCK_COLORS[day.timeBlocks.length % BLOCK_COLORS.length];
    day.timeBlocks.push({ id: generateCalendarEntryId(), startMin, endMin, label, color, ampm, completed: false });
  } else {
    if (!calData._recurring) calData._recurring = [];
    const color = BLOCK_COLORS[calData._recurring.length % BLOCK_COLORS.length];
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    calData._recurring.push({
      id: generateCalendarEntryId(), startMin, endMin, label, color, ampm,
      recurrence,
      dayOfWeek:  date.getDay(),
      dayOfMonth: d,
      completedDates: [],
      excludedDates:  [],
    });
  }
  await saveCalendarData();
  // If the inferred period differs from the current clock view, switch to show the new block
  if (ampm !== clockAmPm) {
    clockAmPm = ampm;
    document.querySelectorAll('.ampm-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.ampm === clockAmPm));
  }
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

async function updateTimeBlock(key, blockId, label, recurrence, scope) {
  pushCalendarSnapshot();
  const recurring    = calData._recurring || [];
  const rIdx         = recurring.findIndex(b => b.id === blockId);
  const isRecurring  = rIdx !== -1;

  if (isRecurring) {
    const block = recurring[rIdx];
    if (scope === 'today') {
      // Exclude today from recurrence; create a one-off override on this date
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
      const day = getOrInitDayData(key);
      day.timeBlocks.push({
        id: generateCalendarEntryId(), startMin: block.startMin, endMin: block.endMin,
        label, color: block.color, ampm: block.ampm, completed: false,
      });
    } else {
      // Update the template for all occurrences
      block.label = label;
      if (recurrence === 'none') {
        // Convert to a one-off block on the current view date
        recurring.splice(rIdx, 1);
        const day = getOrInitDayData(key);
        const completed = block.completedDates?.includes(key) || false;
        day.timeBlocks.push({
          id: block.id, startMin: block.startMin, endMin: block.endMin,
          label, color: block.color, ampm: block.ampm, completed,
        });
      } else {
        block.recurrence = recurrence;
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        block.dayOfWeek  = date.getDay();
        block.dayOfMonth = d;
      }
    }
  } else {
    // Block lives on a single date in calData[key].timeBlocks, not in calData._recurring
    const block = calData[key]?.timeBlocks?.find(b => b.id === blockId);
    if (!block) return;
    block.label = label;
    if (recurrence !== 'none') {
      // Move the block out of date-specific storage and into calData._recurring
      calData[key].timeBlocks = calData[key].timeBlocks.filter(b => b.id !== blockId);
      if (!calData._recurring) calData._recurring = [];
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      calData._recurring.push({
        id: block.id, startMin: block.startMin, endMin: block.endMin,
        label, color: block.color, ampm: block.ampm,
        recurrence,
        dayOfWeek:  date.getDay(),
        dayOfMonth: d,
        completedDates: block.completed ? [key] : [],
        excludedDates:  [],
      });
    }
  }
  await saveCalendarData();
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}

async function deleteTimeBlock(key, blockId, scope) {
  pushCalendarSnapshot();
  const recurring = calData._recurring || [];
  const rIdx      = recurring.findIndex(b => b.id === blockId);
  if (rIdx !== -1) {
    // scope: 'today' = exclude this date; 'all' or undefined = remove template
    // 'prompt' = called from task list delete button (treat same as 'all' — popup handles scoping)
    if (scope === 'today') {
      const block = recurring[rIdx];
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
    } else {
      recurring.splice(rIdx, 1);
    }
    await saveCalendarData();
    if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    return;
  }
  const day = calData[key];
  if (!day?.timeBlocks) return;
  day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
  await saveCalendarData();
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

// ── Block legend ────────────────────────────────────────
function renderBlockLegend(key, blocks, svg) {
  const legend = document.getElementById('block-legend');
  legend.innerHTML = '';

  if (!blocks.length) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:12px;color:var(--text-muted)';
    hint.textContent   = 'Drag on the clock ring to add a time block';
    legend.appendChild(hint);
    return;
  }

  blocks.forEach(block => {
    const chip = document.createElement('span');
    chip.className   = 'block-chip';
    chip.textContent = block._recurring ? block.label + ' \u21BB' : block.label;
    chip.style.background = block.color;
    chip.title = `${formatClockMinutes(block.startMin)} – ${formatClockMinutes(block.endMin, block.ampm)}`;
    chip.addEventListener('click', () => showTimeBlockPopup('edit', block, key, svg, 200, 200, 170));
    legend.appendChild(chip);
  });
}

function formatClockMinutes(min, ampm = '') {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = min % 60;
  const base = `${h}:${String(m).padStart(2, '0')}`;
  return ampm ? `${base} ${ampm}` : base;
}

// ── Task list sidebar ───────────────────────────────────
function renderTaskList(key, allBlocks, svg) {
  const list = document.getElementById('task-list');
  list.innerHTML = '';

  if (!allBlocks.length) {
    const empty = document.createElement('div');
    empty.className   = 'task-empty';
    empty.textContent = 'No blocks scheduled.\nDrag the clock ring to add one.';
    list.appendChild(empty);
    return;
  }

  // Sort: AM blocks first (by startMin), then PM blocks (by startMin)
  const sorted = [...allBlocks].sort((a, b) => {
    const aOrd = (a.ampm === 'PM' ? 720 : 0) + a.startMin;
    const bOrd = (b.ampm === 'PM' ? 720 : 0) + b.startMin;
    return aOrd - bOrd;
  });

  sorted.forEach(block => {
    const past = isPastBlock(block) && !block.completed;

    const item = document.createElement('div');
    item.className = 'task-item' +
      (block.completed ? ' completed' : '') +
      (past ? ' past' : '');

    const swatch = document.createElement('div');
    swatch.className        = 'task-color-swatch';
    swatch.style.background = block.color;

    const body = document.createElement('div');
    body.className = 'task-body';

    const lbl = document.createElement('div');
    lbl.className = 'task-label';
    lbl.textContent = block.label;
    if (block._recurring) {
      const badge = document.createElement('span');
      badge.className   = 'task-recur-badge';
      badge.textContent = '\u21BB'; // ↻
      lbl.appendChild(badge);
    }

    const timeEl = document.createElement('div');
    timeEl.className   = 'task-time';
    timeEl.textContent = `${formatClockMinutes(block.startMin)} – ${formatClockMinutes(block.endMin, block.ampm)}`;

    body.append(lbl, timeEl);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const btnComplete = document.createElement('button');
    btnComplete.className   = 'task-btn';
    btnComplete.title       = block.completed ? 'Mark incomplete' : 'Mark complete';
    btnComplete.textContent = block.completed ? '\u21BA' : '\u2713'; // ↺ / ✓
    btnComplete.addEventListener('click', () => toggleBlockCompleted(key, block.id));

    const btnReschedule = document.createElement('button');
    btnReschedule.className   = 'task-btn';
    btnReschedule.title       = 'Move to another day';
    btnReschedule.textContent = '\u29C9'; // ⧉ (move/copy icon)
    btnReschedule.addEventListener('click', () => startReschedule(block, key));
    if (block._recurring) btnReschedule.style.display = 'none';

    const btnDel = document.createElement('button');
    btnDel.className   = 'task-btn task-btn-del';
    btnDel.title       = 'Delete block';
    btnDel.textContent = '\u00D7'; // ×
    btnDel.addEventListener('click', () => {
      if (block._recurring) {
        // Show inline scope choice: Today / All / Cancel
        const todayBtn = document.createElement('button');
        todayBtn.className   = 'task-btn';
        todayBtn.textContent = 'Today';
        todayBtn.title       = 'Remove just from this day';
        todayBtn.addEventListener('click', () => deleteTimeBlock(key, block.id, 'today'));

        const allBtn = document.createElement('button');
        allBtn.className   = 'task-btn task-btn-del';
        allBtn.textContent = 'All';
        allBtn.title       = 'Remove from all days';
        allBtn.addEventListener('click', () => deleteTimeBlock(key, block.id, 'all'));

        const cancelBtn = document.createElement('button');
        cancelBtn.className   = 'task-btn';
        cancelBtn.textContent = '\u21A9'; // ↩
        cancelBtn.title       = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
        });

        actions.innerHTML = '';
        actions.append(todayBtn, allBtn, cancelBtn);
      } else {
        deleteTimeBlock(key, block.id);
      }
    });

    actions.append(btnComplete, btnReschedule, btnDel);
    item.append(swatch, body, actions);
    list.appendChild(item);
  });
}

// ── Block state helpers ─────────────────────────────────
// Infer whether a block drawn at `startMin` belongs to AM or PM.
// Compares both 12-hr interpretations against the current wall-clock time:
//   - one past, one future → pick the future one
//   - both past or both future → fall back to the current clock mode
function inferBlockAmPm(startMin) {
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const amStart = startMin;
  const pmStart = startMin + 720;
  if (amStart < nowMin && pmStart >= nowMin) return 'PM';
  if (pmStart < nowMin && amStart >= nowMin) return 'AM';
  return clockAmPm;
}

function isPastBlock(block) {
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let endMin = block.ampm === 'PM' ? block.endMin + 720 : block.endMin;
  // AM block crossing noon (e.g. 10 AM→12 PM): endMin wraps to a value < startMin on the 12-hr face
  if (block.ampm === 'AM' && block.endMin < block.startMin) {
    endMin = block.endMin + 720;
  }
  return nowMin >= endMin;
}

async function toggleBlockCompleted(key, blockId) {
  pushCalendarSnapshot();
  const rBlock = (calData._recurring || []).find(b => b.id === blockId);
  if (rBlock) {
    if (!rBlock.completedDates) rBlock.completedDates = [];
    const idx = rBlock.completedDates.indexOf(key);
    if (idx === -1) rBlock.completedDates.push(key);
    else            rBlock.completedDates.splice(idx, 1);
    await saveCalendarData();
    if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    return;
  }
  const block = calData[key]?.timeBlocks?.find(b => b.id === blockId);
  if (!block) return;
  block.completed = !block.completed;
  await saveCalendarData();
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

// ── Reschedule (move to another day) ───────────────────
function startReschedule(block, key) {
  rescheduleBlock = { ...block, _key: key };
  updateRescheduleBanner();
  renderScheduleView(key);
}

function updateRescheduleBanner() {
  const banner = document.getElementById('reschedule-banner');
  if (!rescheduleBlock) { banner.classList.add('hidden'); return; }

  banner.classList.remove('hidden');
  document.getElementById('reschedule-label').textContent = rescheduleBlock.label;

  // Default date input to tomorrow (or today if not set)
  const input = document.getElementById('reschedule-date-input');
  if (!input.value) {
    const src   = rescheduleBlock._key.split('-').map(Number);
    const dt    = new Date(src[0], src[1] - 1, src[2] + 1);
    input.value = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }
}

async function confirmReschedule() {
  if (!rescheduleBlock) return;
  pushCalendarSnapshot();
  const input   = document.getElementById('reschedule-date-input');
  const newKey  = input.value;
  if (!newKey || newKey === rescheduleBlock._key) { cancelReschedule(); return; }

  const { id, startMin, endMin, label, color, ampm, completed, _key: oldKey } = rescheduleBlock;

  // Remove from old day without full re-render yet
  const oldDay = calData[oldKey];
  if (oldDay?.timeBlocks) {
    oldDay.timeBlocks = oldDay.timeBlocks.filter(b => b.id !== id);
    if (!oldDay.timeBlocks.length && !oldDay.events?.length) delete calData[oldKey];
  }

  // Add to new day (keep same id so it's clearly the same block)
  const newDay = getOrInitDayData(newKey);
  newDay.timeBlocks.push({ id, startMin, endMin, label, color, ampm, completed: completed || false });

  rescheduleBlock = null;
  await saveCalendarData();
  renderScheduleView(scheduleDate); // stay on current day view; new day visible when navigated
}

function cancelReschedule() {
  rescheduleBlock = null;
  const banner = document.getElementById('reschedule-banner');
  if (banner) banner.classList.add('hidden');
  document.getElementById('reschedule-date-input').value = '';
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}

// ── Current time hand ───────────────────────────────────
// fromInterval=true only when called from setInterval — prevents overriding manual AM/PM toggles
function updateClockHand(fromInterval = false) {
  const hand = document.getElementById('clock-hand');
  if (!hand) return;
  const now = new Date();
  const min = (now.getHours() % 12) * 60 + now.getMinutes();
  const ang = (min / 720) * 2 * Math.PI - Math.PI / 2;
  const cx = 200, cy = 200, R = 170;
  const r1 = Math.round(R * 0.62);
  hand.setAttribute('x1', cx + 10 * Math.cos(ang));
  hand.setAttribute('y1', cy + 10 * Math.sin(ang));
  hand.setAttribute('x2', cx + r1 * Math.cos(ang));
  hand.setAttribute('y2', cy + r1 * Math.sin(ang));

  // Auto-switch AM/PM only from the interval timer, so manual toggles are respected
  if (fromInterval) {
    const expected = now.getHours() < 12 ? 'AM' : 'PM';
    if (clockAmPm !== expected) {
      clockAmPm = expected;
      document.querySelectorAll('.ampm-btn')
        .forEach(b => b.classList.toggle('active', b.dataset.ampm === clockAmPm));
      if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    }
  }
}

// ── Start ──────────────────────────────────────────────
initCalendarApp();
startDayChangeWatcher();
setInterval(() => updateClockHand(true), 60_000);
