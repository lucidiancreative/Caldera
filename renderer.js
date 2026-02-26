/* ────────────────────────────────────────────────────────
   Caldera – renderer.js
   Multi-event calendar: each day holds an array of events.
   Data shape per day:
     { events: [{ id, image, time, notes }], featuredId }
──────────────────────────────────────────────────────── */

const api = window.calAPI;

// ── State ──────────────────────────────────────────────
let calData       = {};
let viewYear      = new Date().getFullYear();
let viewMonth     = new Date().getMonth();
let modalDate     = null;
let pasteCellDate = null;

const today    = new Date();
const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

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

async function save() {
  await api.saveData(calData);
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
async function renderGrid() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'day-cell empty';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key  = dateKey(viewYear, viewMonth, d);
    const cell = document.createElement('div');
    cell.className   = 'day-cell';
    cell.dataset.date = key;
    if (key === todayKey) cell.classList.add('today');

    const dayNum = document.createElement('span');
    dayNum.className = 'day-num';
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    const featured = getFeaturedEvent(key);
    if (featured?.image) {
      cell.classList.add('has-image');
      const fullPath = await api.resolveImage(featured.image);
      const bg = document.createElement('div');
      bg.className = 'cell-bg';
      bg.style.backgroundImage = `url("${fileUrl(fullPath)}")`;
      cell.insertBefore(bg, dayNum);
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
    cell.addEventListener('mouseenter', () => { pasteCellDate = key; });
    cell.addEventListener('mouseleave', () => { pasteCellDate = null; });

    grid.appendChild(cell);
  }
}

async function refreshCell(key) {
  const cell = document.querySelector(`.day-cell[data-date="${key}"]`);
  if (!cell) return;

  cell.querySelector('.cell-bg')?.remove();
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
    api.resolveImage(ev.image).then(p => { img.src = fileUrl(p); });
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
  notes.addEventListener('input', () => saveEventField(key, ev.id, 'notes', notes.value.trim()));

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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalDate) closeModal();
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

// ── Start ──────────────────────────────────────────────
init();
