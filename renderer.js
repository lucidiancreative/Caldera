/* ────────────────────────────────────────────────────────
   Caldera – renderer.js
   Multi-event calendar: each day holds an array of events.
   Data shape per day:
     { events: [{ id, image, time, notes }], featuredId }
──────────────────────────────────────────────────────── */

const api = window.calAPI;

// ── State ──────────────────────────────────────────────
let calData         = {};
let viewYear        = new Date().getFullYear();
let viewMonth       = new Date().getMonth();
let modalDate       = null;
let pasteCellDate   = null;
let renderedTodayKey = null;
let hoverCell = null;
let activeView      = 'calendar';
let scheduleDate    = null;
let clockDrag       = null;
let popupState      = null;
let clockAmPm       = 'AM';
let rescheduleBlock = null;
const BLOCK_COLORS = ['#4f6ef7', '#e03030', '#2eb67d', '#f0a500', '#a259ff', '#ff6b35'];

// ── Boot ───────────────────────────────────────────────
async function init() {
  applyTheme(localStorage.getItem('theme') === 'dark');
  const raw = await api.loadData();
  calData = migrateData(raw);
  renderStrip();
  renderGrid();
  bindUI();
}

function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  document.getElementById('btn-theme').textContent = dark ? '\u2600' : '\u263E';
}

// ── Helpers ────────────────────────────────────────────
function genId() {
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

function fileUrl(absPath) {
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

async function save() {
  await api.saveData(calData);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const SCROLL_PX_PER_SEC = 20;

function getImageNaturalSize(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });
}

// ── Migration: old single-event format → new multi-event ──
function migrateData(raw) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val.events) {
      out[key] = val;
      if (!out[key].timeBlocks) out[key].timeBlocks = [];
      out[key].timeBlocks.forEach(b => {
        if (!b.ampm)             b.ampm      = 'AM';
        if (b.completed == null) b.completed = false;
      });
    } else {
      const id = genId();
      out[key] = {
        events:     [{ id, image: val.image || null, notes: val.notes || '', time: val.time || '' }],
        featuredId: val.image ? id : null,
      };
    }
  }
  return out;
}

// ── Day data helpers ────────────────────────────────────
function getDay(key) {
  if (!calData[key]) calData[key] = { events: [], featuredId: null, timeBlocks: [] };
  if (!calData[key].timeBlocks) calData[key].timeBlocks = [];
  return calData[key];
}

function getFeaturedEvent(key) {
  const day = calData[key];
  if (!day?.events?.length) return null;
  return day.events.find(e => e.id === day.featuredId) || day.events[0];
}

function normaliseDay(key) {
  const day = calData[key];
  if (!day) return;
  if (!day.events.length) { delete calData[key]; return; }
  if (!day.events.find(e => e.id === day.featuredId)) {
    day.featuredId = day.events[0].id;
  }
}

// ── Strip ──────────────────────────────────────────────
function renderStrip() {
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
async function renderGrid() {
  hoverCell = null;

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
        api.resolveImage(featured.image).then(fullPath => {
          bg.style.backgroundImage = `url("${fileUrl(fullPath)}")`;
        })
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
    cell.addEventListener('dragover',  onDragOver);
    cell.addEventListener('dragleave', onCellDragLeave);
    cell.addEventListener('drop',      onDrop);
    cell.addEventListener('click', () => {
      scheduleDate = key;
      if (activeView === 'schedule') renderScheduleView(key);
      openModal(key);
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

async function refreshCell(key) {
  const cell = document.querySelector(`.day-cell[data-date="${key}"]`);
  if (!cell) return;

  // If this cell has an active hover strip, cancel it
  if (hoverCell === cell) hoverCell = null;

  cell.querySelector('.cell-bg')?.remove();
  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.querySelector('.cell-time')?.remove();
  cell.querySelector('.cell-count')?.remove();

  const featured = getFeaturedEvent(key);
  if (featured?.image) {
    cell.classList.add('has-image');
    const fullPath = await api.resolveImage(featured.image);
    const bg = document.createElement('div');
    bg.className = 'cell-bg';
    bg.style.backgroundImage = `url("${fileUrl(fullPath)}")`;
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
  hoverCell = cell;

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
      const fullPath = await api.resolveImage(ev.image);
      const url      = fileUrl(fullPath);
      const size     = await getImageNaturalSize(url);
      return { url, size };
    })
  );

  // Bail if the mouse left this cell while images were loading
  if (hoverCell !== cell) return;

  // One segment per image
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
  const duration    = (totalTravel / SCROLL_PX_PER_SEC).toFixed(2);
  strip.style.setProperty('--scroll-dist', `-${totalTravel}px`);
  strip.style.animation = `cell-strip-scroll ${duration}s linear infinite`;
}

function teardownHoverScrollStrip(cell) {
  hoverCell = null;
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
function onDragOver(e) { e.preventDefault(); }
function onCellDragLeave(e) {
  const cell  = e.currentTarget;
  const count = (dragCounters.get(cell) || 1) - 1;
  dragCounters.set(cell, count);
  if (count <= 0) { dragCounters.set(cell, 0); cell.classList.remove('drag-over'); }
}
async function onDrop(e) {
  e.preventDefault();
  const cell = e.currentTarget;
  dragCounters.set(cell, 0);
  cell.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return;

  await addEventFromPath(cell.dataset.date, api.getPathForFile(file));
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
    const id       = genId();
    const fileName = `${targetKey}-${id}`;
    const buf      = await blob.arrayBuffer();
    const relPath  = await api.saveImageBuffer(Array.from(new Uint8Array(buf)), fileName, ext);
    await addEventWithImage(targetKey, id, relPath);
    break;
  }
});

// ── Event management ───────────────────────────────────
async function addEventFromPath(key, srcPath) {
  const id       = genId();
  const fileName = `${key}-${id}`;
  const relPath  = await api.copyImage(srcPath, fileName);
  await addEventWithImage(key, id, relPath);
}

async function addEventWithImage(key, id, relPath) {
  const day = getDay(key);
  day.events.push({ id, image: relPath, notes: '', time: '' });
  // Auto-feature the very first event on a day
  if (!day.featuredId) day.featuredId = id;
  await save();
  await refreshCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function addEmptyEvent(key) {
  const day = getDay(key);
  const id  = genId();
  day.events.push({ id, image: null, notes: '', time: '' });
  if (!day.featuredId) day.featuredId = id;
  await save();
  if (modalDate === key) renderEventCards(key);
}

async function removeEvent(key, eventId) {
  const day = calData[key];
  if (!day) return;

  const ev = day.events.find(e => e.id === eventId);
  if (ev?.image) await api.deleteImage(ev.image);

  day.events = day.events.filter(e => e.id !== eventId);
  if (day.featuredId === eventId) day.featuredId = day.events[0]?.id || null;

  normaliseDay(key);
  await save();
  await refreshCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function setFeatured(key, eventId) {
  const day = calData[key];
  if (!day) return;
  day.featuredId = eventId;
  await save();
  await refreshCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function saveEventField(key, eventId, field, value) {
  const day = calData[key];
  if (!day) return;
  const ev = day.events.find(e => e.id === eventId);
  if (!ev) return;
  if (value) ev[field] = value; else delete ev[field];
  if (field === 'time' && day.featuredId === eventId) await refreshCell(key);
  await save();
}

async function assignEventImage(key, eventId, srcPath) {
  const day = calData[key];
  const ev  = day?.events.find(e => e.id === eventId);
  if (!ev) return;

  if (ev.image) await api.deleteImage(ev.image);
  const fileName = `${key}-${eventId}`;
  ev.image = await api.copyImage(srcPath, fileName);

  // If the day has no featured image yet, promote this event
  const hasFeaturedImg = day.events.find(e => e.id === day.featuredId)?.image;
  if (!hasFeaturedImg) day.featuredId = eventId;

  await save();
  await refreshCell(key);
  if (modalDate === key) renderEventCards(key);
}

async function removeEventImage(key, eventId) {
  const day = calData[key];
  const ev  = day?.events.find(e => e.id === eventId);
  if (!ev?.image) return;

  await api.deleteImage(ev.image);
  ev.image = null;

  // If this was the featured event, find another with an image
  if (day.featuredId === eventId) {
    const other = day.events.find(e => e.id !== eventId && e.image);
    day.featuredId = other?.id || day.events.find(e => e.id !== eventId)?.id || null;
  }

  await save();
  await refreshCell(key);
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
function openModal(key) {
  modalDate = key;
  document.getElementById('modal-date').textContent = formatDisplayDate(key);
  renderEventCards(key);
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
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
    await addEventFromPath(modalDate, api.getPathForFile(file));
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
  if (!isFeatured) btnCover.addEventListener('click', () => setFeatured(key, ev.id));

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
    const srcPath = await api.openFileDialog();
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
    api.resolveImage(ev.image).then(p => { img.src = fileUrl(p); });
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
    await assignEventImage(key, ev.id, api.getPathForFile(file));
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
function bindUI() {
  document.getElementById('btn-min').addEventListener('click', () => api.winMinimize());
  document.getElementById('btn-max').addEventListener('click', () => api.winMaximize());
  document.getElementById('btn-close').addEventListener('click', () => api.winClose());

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
      renderStrip();
      renderGrid();
      if (activeView !== 'calendar') switchView('calendar');
    });
  });

  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
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

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox-overlay')) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('lightbox-overlay').classList.contains('hidden')) closeLightbox();
      else if (modalDate) closeModal();
      else if (rescheduleBlock) cancelReschedule();
    }
  });

  document.getElementById('btn-add-event').addEventListener('click', () => {
    if (modalDate) addEmptyEvent(modalDate);
  });

  document.getElementById('btn-schedule-day').addEventListener('click', () => {
    closeModal();
    switchView('schedule');
  });
}

function changeMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
  renderStrip();
  renderGrid();
  if (activeView !== 'calendar') switchView('calendar');
}

function changeYear(delta) {
  viewYear += delta;
  renderStrip();
  renderGrid();
  if (activeView !== 'calendar') switchView('calendar');
}

// ── Day-change watcher ─────────────────────────────────
// Polls every 60 s so the today-highlight updates correctly after
// midnight or when the system wakes from sleep.
function startDayChangeWatcher() {
  setInterval(() => {
    if (getTodayKey() !== renderedTodayKey) renderGrid();
  }, 60_000);
}

// ── View switching ──────────────────────────────────────
function switchView(view) {
  activeView = view;
  document.getElementById('calendar-wrapper').classList.toggle('hidden', view !== 'calendar');
  document.getElementById('schedule-view').classList.toggle('hidden', view !== 'schedule');
  document.querySelectorAll('.view-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );
  if (view === 'schedule') {
    if (!scheduleDate) scheduleDate = getTodayKey();
    clockAmPm = new Date().getHours() >= 12 ? 'PM' : 'AM';
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

  const allBlocks     = calData[key]?.timeBlocks || [];
  const visibleBlocks = allBlocks.filter(b => b.ampm === clockAmPm);
  const svg           = buildClockSVG(key, visibleBlocks);
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

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  }

  // Defs (for arc label text paths)
  const defs = el('defs', {});
  svg.appendChild(defs);

  // Clock face
  svg.appendChild(el('circle', { class: 'clock-face', cx, cy, r: R }));

  // Hour ticks + numbers (1–11 in loop, 12 separate)
  for (let h = 0; h < 12; h++) {
    const ang      = (h / 12) * 2 * Math.PI - Math.PI / 2;
    const cos      = Math.cos(ang), sin = Math.sin(ang);
    const isMajor  = h % 3 === 0;
    const tickIn   = R * (isMajor ? 0.88 : 0.91);
    const tickOut  = R * 0.975;

    svg.appendChild(el('line', {
      class: isMajor ? 'clock-tick clock-tick-major' : 'clock-tick',
      x1: cx + tickIn * cos,  y1: cy + tickIn * sin,
      x2: cx + tickOut * cos, y2: cy + tickOut * sin,
    }));

    const label = h === 0 ? '12' : String(h);
    const numR  = R * 0.73;
    const txt   = el('text', { class: 'clock-num', x: cx + numR * cos, y: cy + numR * sin });
    txt.textContent = label;
    svg.appendChild(txt);
  }

  // Existing time blocks (drawn below preview + hand)
  blocks.forEach(block => {
    const isRescheduling = rescheduleBlock?.id === block.id;
    const path = el('path', {
      class: 'clock-block-arc' + (isRescheduling ? ' rescheduling-arc' : ''),
      d:     arcPath(cx, cy, r1, r2, block.startMin, block.endMin),
      fill:  block.color,
    });
    path.addEventListener('click', (e) => {
      e.stopPropagation();
      showBlockPopup('edit', block, key, svg, cx, cy, R);
    });
    svg.appendChild(path);

    // Curved label along the arc midline
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

      defs.appendChild(el('path', { id: pathId, d: `M ${lx1} ${ly1} A ${rMid} ${rMid} 0 ${large} 1 ${lx2} ${ly2}` }));

      const tp = el('textPath', { href: `#${pathId}`, startOffset: '50%', 'text-anchor': 'middle' });
      tp.textContent = display;
      const textEl = el('text', { class: 'clock-block-label' });
      textEl.appendChild(tp);
      svg.appendChild(textEl);
    }
  });

  // Preview arc (empty until drag)
  const preview = el('path', { id: 'clock-preview-arc', class: 'clock-preview', fill: '#888', d: '' });
  svg.appendChild(preview);

  // Current-time hand
  const hand = el('line', { id: 'clock-hand', class: 'clock-hand', x1: cx, y1: cy, x2: cx, y2: cy });
  svg.appendChild(hand);

  // Center dot
  svg.appendChild(el('circle', { class: 'clock-hand-dot', cx, cy, r: 5 }));

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
    if (popupState) return;
    const pt   = svgPoint(svg, e);
    const dist = Math.hypot(pt.x - cx, pt.y - cy);
    if (dist < r1 - 10 || dist > r2 + 10) return;

    const startMin     = minutesFromPoint(cx, cy, pt.x, pt.y);
    const previewPath  = document.getElementById('clock-preview-arc');
    const previewColor = BLOCK_COLORS[(calData[key]?.timeBlocks?.length || 0) % BLOCK_COLORS.length];
    previewPath.setAttribute('fill', previewColor);

    let lastMin = startMin;

    function onMove(ev) {
      const pt2 = svgPoint(svg, ev);
      lastMin   = minutesFromPoint(cx, cy, pt2.x, pt2.y);
      const span = (lastMin - startMin + 720) % 720;
      previewPath.setAttribute('d', span >= 15 ? arcPath(cx, cy, r1, r2, startMin, lastMin) : '');
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      previewPath.setAttribute('d', '');
      clockDrag = null;

      const endMin = lastMin;
      const span   = (endMin - startMin + 720) % 720;
      if (span < 15) return;
      showBlockPopup('new', { startMin, endMin }, key, svg, cx, cy, 170);
    }

    clockDrag = { startMin, svg };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ── Block popup ─────────────────────────────────────────
function showBlockPopup(mode, blockOrData, key, svg, cx, cy, R) {
  const popup  = document.getElementById('block-label-popup');
  const input  = document.getElementById('block-label-input');
  const delBtn = document.getElementById('block-label-del');
  const { startMin, endMin, id, label } = blockOrData;

  popupState = { mode, key, startMin, endMin, id };
  input.value = label || '';

  // Position near arc midpoint (SVG → screen)
  const spanMin = (endMin - startMin + 720) % 720;
  const midMin  = (startMin + spanMin / 2) % 720;
  const ang     = (midMin / 720) * 2 * Math.PI - Math.PI / 2;
  const r       = (R * 0.62 + R * 0.85) / 2;
  const rect    = svg.getBoundingClientRect();
  const sx      = rect.left + (cx + r * Math.cos(ang)) * (rect.width  / 400);
  const sy      = rect.top  + (cy + r * Math.sin(ang)) * (rect.height / 400);

  popup.style.left = Math.min(sx - 10,  window.innerWidth  - 260) + 'px';
  popup.style.top  = Math.min(sy - 20,  window.innerHeight - 60)  + 'px';
  delBtn.title = mode === 'new' ? 'Cancel' : 'Delete block';

  popup.classList.remove('hidden');
  input.focus();

  function commit() {
    const lbl = input.value.trim();
    closeBlockPopup();
    if (!lbl) {
      if (mode === 'edit' && id) deleteTimeBlock(key, id);
      return;
    }
    if (mode === 'new') {
      saveTimeBlock(key, { startMin, endMin, label: lbl });
    } else if (mode === 'edit' && id) {
      updateTimeBlockLabel(key, id, lbl);
    }
  }

  function onKeyDown(ev) {
    if (ev.key === 'Enter')  { ev.preventDefault(); commit(); }
    if (ev.key === 'Escape') { closeBlockPopup(); }
  }
  // Delay blur so the delete-button click fires first
  function onBlur() { setTimeout(() => { if (popupState) commit(); }, 150); }
  function onDel()  { closeBlockPopup(); if (mode === 'edit' && id) deleteTimeBlock(key, id); }

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur',    onBlur);
  delBtn.addEventListener('click',  onDel);

  popupState._cleanup = () => {
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur',    onBlur);
    delBtn.removeEventListener('click',  onDel);
  };
}

function closeBlockPopup() {
  const popup = document.getElementById('block-label-popup');
  popup.classList.add('hidden');
  if (popupState?._cleanup) popupState._cleanup();
  popupState = null;
}

// ── Time block data operations ──────────────────────────
function saveTimeBlock(key, { startMin, endMin, label }) {
  const day   = getDay(key);
  const color = BLOCK_COLORS[day.timeBlocks.length % BLOCK_COLORS.length];
  day.timeBlocks.push({ id: genId(), startMin, endMin, label, color, ampm: clockAmPm, completed: false });
  save();
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

function updateTimeBlockLabel(key, blockId, label) {
  const block = calData[key]?.timeBlocks?.find(b => b.id === blockId);
  if (!block) return;
  block.label = label;
  save();
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

function deleteTimeBlock(key, blockId) {
  const day = calData[key];
  if (!day?.timeBlocks) return;
  day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
  save();
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
    chip.textContent = block.label;
    chip.style.background = block.color;
    chip.title = `${formatMin(block.startMin)} – ${formatMin(block.endMin, block.ampm)}`;
    chip.addEventListener('click', () => showBlockPopup('edit', block, key, svg, 200, 200, 170));
    legend.appendChild(chip);
  });
}

function formatMin(min, ampm = '') {
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
    lbl.className   = 'task-label';
    lbl.textContent = block.label;

    const timeEl = document.createElement('div');
    timeEl.className   = 'task-time';
    timeEl.textContent = `${formatMin(block.startMin)} – ${formatMin(block.endMin, block.ampm)}`;

    body.append(lbl, timeEl);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const btnComplete = document.createElement('button');
    btnComplete.className   = 'task-btn';
    btnComplete.title       = block.completed ? 'Mark incomplete' : 'Mark complete';
    btnComplete.textContent = block.completed ? '\u21BA' : '\u2713'; // ↺ / ✓
    btnComplete.addEventListener('click', () => toggleCompleted(key, block.id));

    const btnReschedule = document.createElement('button');
    btnReschedule.className   = 'task-btn';
    btnReschedule.title       = 'Move to another day';
    btnReschedule.textContent = '\u29C9'; // ⧉ (move/copy icon)
    btnReschedule.addEventListener('click', () => startReschedule(block, key));

    const btnDel = document.createElement('button');
    btnDel.className   = 'task-btn task-btn-del';
    btnDel.title       = 'Delete block';
    btnDel.textContent = '\u00D7'; // ×
    btnDel.addEventListener('click', () => deleteTimeBlock(key, block.id));

    actions.append(btnComplete, btnReschedule, btnDel);
    item.append(swatch, body, actions);
    list.appendChild(item);
  });
}

// ── Block state helpers ─────────────────────────────────
function isPastBlock(block) {
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const endMin = block.ampm === 'PM' ? block.endMin + 720 : block.endMin;
  return nowMin >= endMin;
}

function toggleCompleted(key, blockId) {
  const block = calData[key]?.timeBlocks?.find(b => b.id === blockId);
  if (!block) return;
  block.completed = !block.completed;
  save();
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

function confirmReschedule() {
  if (!rescheduleBlock) return;
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
  const newDay = getDay(newKey);
  newDay.timeBlocks.push({ id, startMin, endMin, label, color, ampm, completed: completed || false });

  rescheduleBlock = null;
  save();
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
function updateClockHand() {
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
}

// ── Start ──────────────────────────────────────────────
init();
startDayChangeWatcher();
setInterval(updateClockHand, 60_000);
