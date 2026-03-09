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
  if (!calData[key]) calData[key] = { events: [], featuredId: null };
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
    cell.addEventListener('click',     () => openModal(key));
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
    });
  });

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
    }
  });

  document.getElementById('btn-add-event').addEventListener('click', () => {
    if (modalDate) addEmptyEvent(modalDate);
  });
}

function changeMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
  renderStrip();
  renderGrid();
}

function changeYear(delta) {
  viewYear += delta;
  renderStrip();
  renderGrid();
}

// ── Day-change watcher ─────────────────────────────────
// Polls every 60 s so the today-highlight updates correctly after
// midnight or when the system wakes from sleep.
function startDayChangeWatcher() {
  setInterval(() => {
    if (getTodayKey() !== renderedTodayKey) renderGrid();
  }, 60_000);
}

// ── Start ──────────────────────────────────────────────
init();
startDayChangeWatcher();
