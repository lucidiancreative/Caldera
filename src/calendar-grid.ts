function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

const CELL_HOVER_SCROLL_PX_PER_SEC = 20;

function measureImageNaturalDimensions(url: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });
}

function renderMonthStrip(): void {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  qId('current-label').textContent = `${months[viewMonth]} ${viewYear}`;
  (document.querySelectorAll('.month-tab') as NodeListOf<HTMLElement>).forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.month!, 10) === viewMonth)
  );
}

async function renderCalendarGrid(): Promise<void> {
  hoveredGridCell = null;

  const grid = qId('calendar-grid');
  if (_skinSwitchPending && grid.children.length > 0) {
    grid.classList.remove('skin-fade-in');
    grid.classList.add('skin-fade-out');
    await new Promise(resolve => setTimeout(resolve, 400));
    grid.classList.remove('skin-fade-out');
  }

  grid.innerHTML = '';

  if (_skinSwitchPending) {
    grid.classList.add('skin-fade-in');
    _skinSwitchPending = false;
  } else if (document.body.classList.contains('skin-glass')) {
    grid.classList.remove('is-entering');
    void grid.offsetHeight;
    grid.classList.add('is-entering');
  }

  const todayKey = getTodayKey();
  renderedTodayKey = todayKey;
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let index = 0; index < firstDay; index++) {
    const blank = document.createElement('div');
    blank.className = 'day-cell empty';
    grid.appendChild(blank);
  }

  const imageResolves: Promise<void>[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(viewYear, viewMonth, day);
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.dataset.date = key;
    if (key === todayKey) cell.classList.add('today');
    if (key < todayKey) cell.classList.add('past');

    const dayNum = document.createElement('span');
    dayNum.className = 'day-num';
    dayNum.textContent = String(day);
    cell.appendChild(dayNum);

    const featured = getFeaturedEvent(key);
    if (featured?.image) {
      cell.classList.add('has-image');
      const bg = document.createElement('div');
      bg.className = 'cell-bg';
      cell.insertBefore(bg, dayNum);
      imageResolves.push(
        resolveCalendarImageUrl(featured.image)
          .then(url => {
            bg.style.backgroundImage = `url("${url}")`;
          })
          .catch(err => console.error(`Failed to resolve featured image for ${key}:`, err))
      );
    }

    const count = getDayData(key)?.events?.length || 0;
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'cell-count';
      badge.textContent = String(count);
      cell.appendChild(badge);
    }

    if (featured?.time) {
      const timeBadge = document.createElement('span');
      timeBadge.className = 'cell-time';
      timeBadge.textContent = formatTime12h(featured.time);
      cell.appendChild(timeBadge);
    }

    cell.addEventListener('dragenter', onCellDragEnter);
    cell.addEventListener('dragover', onCellDragOver);
    cell.addEventListener('dragleave', onCellDragLeave);
    cell.addEventListener('drop', onCalendarCellDrop);
    cell.addEventListener('click', () => {
      scheduleDate = key;
      if (activeView === 'schedule') renderScheduleView(key);
      openDayDetailModal(key);
    });
    cell.addEventListener('mouseenter', () => {
      pasteCellDate = key;
      if (getDayData(key)?.events?.some(event => event.image)) {
        void setupHoverScrollStrip(cell, key).catch(console.error);
      }
    });
    cell.addEventListener('mouseleave', () => {
      pasteCellDate = null;
      teardownHoverScrollStrip(cell);
    });

    grid.appendChild(cell);
  }

  await Promise.all(imageResolves);
}

async function refreshCalendarCell(key: string): Promise<void> {
  const cell = document.querySelector(`.day-cell[data-date="${key}"]`) as HTMLElement | null;
  if (!cell) return;

  if (hoveredGridCell === cell) hoveredGridCell = null;

  cell.querySelector('.cell-bg')?.remove();
  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.querySelector('.cell-time')?.remove();
  cell.querySelector('.cell-count')?.remove();

  const featured = getFeaturedEvent(key);
  if (featured?.image) {
    cell.classList.add('has-image');
    const bg = document.createElement('div');
    bg.className = 'cell-bg';
    bg.style.backgroundImage = `url("${await resolveCalendarImageUrl(featured.image)}")`;
    cell.insertBefore(bg, cell.querySelector('.day-num'));
  } else {
    cell.classList.remove('has-image');
  }

  const count = getDayData(key)?.events?.length || 0;
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'cell-count';
    badge.textContent = String(count);
    cell.appendChild(badge);
  }

  if (featured?.time) {
    const timeBadge = document.createElement('span');
    timeBadge.className = 'cell-time';
    timeBadge.textContent = formatTime12h(featured.time);
    cell.appendChild(timeBadge);
  }
}

async function setupHoverScrollStrip(cell: HTMLElement, key: string): Promise<void> {
  hoveredGridCell = cell;

  const day = getDayData(key);
  if (!day?.events?.length) return;

  const withImages = day.events.filter(event => event.image);
  if (!withImages.length) return;

  withImages.sort((a, b) => {
    if (a.id === day.featuredId) return -1;
    if (b.id === day.featuredId) return 1;
    return 0;
  });

  const strip = document.createElement('div');
  strip.className = 'cell-scroll-strip';

  const imageInfo = await Promise.all(
    withImages.map(async event => {
      const url = await resolveCalendarImageUrl(event.image!);
      const size = await measureImageNaturalDimensions(url);
      return { url, size };
    })
  );

  if (hoveredGridCell !== cell) return;

  const segments = imageInfo.map(({ url }) => {
    const segment = document.createElement('div');
    segment.className = 'cell-scroll-segment';
    segment.style.backgroundImage = `url("${url}")`;
    strip.appendChild(segment);
    return segment;
  });

  const clone = document.createElement('div');
  clone.className = 'cell-scroll-segment';
  clone.style.backgroundImage = `url("${imageInfo[0].url}")`;
  strip.appendChild(clone);

  cell.querySelector('.cell-scroll-strip')?.remove();
  cell.insertBefore(strip, cell.querySelector('.day-num'));

  const cellHeight = cell.offsetHeight;
  const cellWidth = cell.offsetWidth;
  const segmentHeights = imageInfo.map(({ size }) =>
    Math.max(cellHeight, size.w > 0 ? Math.round((cellWidth * size.h) / size.w) : cellHeight)
  );

  segments.forEach((segment, index) => {
    segment.style.height = `${segmentHeights[index]}px`;
  });
  clone.style.height = `${segmentHeights[0]}px`;

  const totalTravel = segmentHeights.reduce((sum, height) => sum + height, 0);
  const duration = (totalTravel / CELL_HOVER_SCROLL_PX_PER_SEC).toFixed(2);
  strip.style.setProperty('--scroll-dist', `-${totalTravel}px`);
  strip.style.animation = `cell-strip-scroll ${duration}s linear infinite`;
}

function teardownHoverScrollStrip(cell: HTMLElement): void {
  hoveredGridCell = null;
  cell.querySelector('.cell-scroll-strip')?.remove();
}

const dragCounters = new WeakMap<Element, number>();

function onCellDragEnter(e: DragEvent): void {
  e.preventDefault();
  const cell = e.currentTarget as HTMLElement;
  dragCounters.set(cell, (dragCounters.get(cell) || 0) + 1);
  cell.classList.add('drag-over');
}

function onCellDragOver(e: DragEvent): void {
  e.preventDefault();
}

function onCellDragLeave(e: DragEvent): void {
  const cell = e.currentTarget as HTMLElement;
  const count = (dragCounters.get(cell) || 1) - 1;
  dragCounters.set(cell, count);
  if (count <= 0) {
    dragCounters.set(cell, 0);
    cell.classList.remove('drag-over');
  }
}

async function onCalendarCellDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  const cell = e.currentTarget as HTMLElement;
  dragCounters.set(cell, 0);
  cell.classList.remove('drag-over');

  const file = e.dataTransfer!.files[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;

  await addEventFromPath(cell.dataset.date!, calBridge.getPathForFile(file));
}

document.addEventListener('paste', async (e: ClipboardEvent): Promise<void> => {
  const targetKey = modalDate || pasteCellDate;
  if (!targetKey) return;

  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(item.type)) continue;
    const blob = item.getAsFile();
    if (!blob) continue;

    const ext = item.type === 'image/png' ? '.png' : item.type === 'image/webp' ? '.webp' : '.jpg';
    const id = generateCalendarEntryId();
    const fileName = `${targetKey}-${id}`;
    const buf = await blob.arrayBuffer();
    const relPath = await calBridge.saveImageBuffer(Array.from(new Uint8Array(buf)), fileName, ext);
    await addEventWithImage(targetKey, id, relPath);
    break;
  }
});

function openLightbox(url: string): void {
  qId<HTMLImageElement>('lightbox-img').src = url;
  qId('lightbox-overlay').classList.remove('hidden');
}

function closeLightbox(): void {
  qId('lightbox-overlay').classList.add('hidden');
  qId<HTMLImageElement>('lightbox-img').src = '';
}

function openDayDetailModal(key: string): void {
  modalDate = key;
  qId('modal-date').textContent = formatDisplayDate(key);
  renderEventCards(key);
  qId('modal-overlay').classList.remove('hidden');
  if (document.body.classList.contains('skin-glass')) {
    const modal = qId('modal');
    modal.style.animation = 'none';
    void modal.offsetWidth;
    modal.style.animation = '';
  }
}

function closeDayDetailModal(): void {
  modalDate = null;
  qId('modal-overlay').classList.add('hidden');
}

function renderEventCards(key: string): void {
  const container = qId('event-cards');
  container.innerHTML = '';

  const day = getDayData(key);
  const events = day?.events || [];
  events.forEach(event => {
    container.appendChild(buildEventCard(key, event, event.id === day?.featuredId));
  });

  const zone = document.createElement('div');
  zone.className = 'modal-add-zone';
  zone.textContent = events.length === 0
    ? 'Drop an image here or click “+ Add Event” to get started'
    : '+ Drop an image here to add another event';

  let zoneCounter = 0;
  zone.addEventListener('dragenter', (e: DragEvent) => {
    e.preventDefault();
    zoneCounter++;
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
  zone.addEventListener('dragleave', () => {
    if (--zoneCounter <= 0) {
      zoneCounter = 0;
      zone.classList.remove('drag-over');
    }
  });
  zone.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    zoneCounter = 0;
    zone.classList.remove('drag-over');
    if (!modalDate) return;
    const file = e.dataTransfer!.files[0];
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    await addEventFromPath(modalDate, calBridge.getPathForFile(file));
  });

  container.appendChild(zone);
}

function buildEventCard(key: string, ev: CalendarEvent, isFeatured: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'event-card' + (isFeatured ? ' featured' : '');
  card.dataset.id = ev.id;

  const toolbar = document.createElement('div');
  toolbar.className = 'card-toolbar';

  const btnCover = document.createElement('button');
  btnCover.className = 'btn-cover';
  btnCover.title = isFeatured ? 'Calendar cover' : 'Set as calendar cover';
  btnCover.textContent = isFeatured ? '\u2605' : '\u2606';
  if (!isFeatured) btnCover.addEventListener('click', () => setFeaturedCalendarEvent(key, ev.id));

  const coverLabel = document.createElement('span');
  coverLabel.className = 'cover-label';
  coverLabel.textContent = 'Cover';
  if (!isFeatured) coverLabel.style.display = 'none';

  const spacer = document.createElement('span');
  spacer.className = 'card-spacer';

  const btnAssign = document.createElement('button');
  btnAssign.className = 'card-action-btn';
  btnAssign.textContent = '\uD83D\uDCF7 Assign';
  btnAssign.title = 'Assign image via file dialog';
  btnAssign.addEventListener('click', async () => {
    const srcPath = await calBridge.openFileDialog();
    if (srcPath) await assignEventImage(key, ev.id, srcPath);
  });

  const btnRemoveImg = document.createElement('button');
  btnRemoveImg.className = 'card-action-btn';
  btnRemoveImg.textContent = '\uD83D\uDDD1 Remove';
  btnRemoveImg.title = 'Remove image';
  btnRemoveImg.style.display = ev.image ? '' : 'none';
  btnRemoveImg.addEventListener('click', () => removeEventImage(key, ev.id));

  const btnDelete = document.createElement('button');
  btnDelete.className = 'card-action-btn btn-del-card';
  btnDelete.textContent = '\u2715';
  btnDelete.title = 'Delete this event';
  btnDelete.addEventListener('click', () => removeEvent(key, ev.id));

  toolbar.append(btnCover, coverLabel, spacer, btnAssign, btnRemoveImg, btnDelete);

  const imgArea = document.createElement('div');
  imgArea.className = 'card-image-area';

  const img = document.createElement('img');
  img.className = 'card-img' + (ev.image ? '' : ' hidden');
  img.alt = '';

  const noImg = document.createElement('div');
  noImg.className = 'card-no-img';
  noImg.textContent = 'Drop image here or use Assign';
  if (ev.image) noImg.style.display = 'none';

  imgArea.append(img, noImg);

  if (ev.image) {
    imgArea.classList.add('has-image');
    void resolveCalendarImageUrl(ev.image)
      .then(url => {
        img.src = url;
      })
      .catch(err => console.error(`Failed to resolve event image for event ${ev.id}:`, err));
    imgArea.addEventListener('click', () => {
      if (img.src) openLightbox(img.src);
    });
  }

  let imgCounter = 0;
  imgArea.addEventListener('dragenter', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    imgCounter++;
    imgArea.classList.add('drag-over');
  });
  imgArea.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  });
  imgArea.addEventListener('dragleave', () => {
    if (--imgCounter <= 0) {
      imgCounter = 0;
      imgArea.classList.remove('drag-over');
    }
  });
  imgArea.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    imgCounter = 0;
    imgArea.classList.remove('drag-over');
    const file = e.dataTransfer!.files[0];
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    await assignEventImage(key, ev.id, calBridge.getPathForFile(file));
  });

  const fields = document.createElement('div');
  fields.className = 'card-fields';

  const timeRow = document.createElement('div');
  timeRow.className = 'card-time-row';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time';
  const timeInput = document.createElement('input') as HTMLInputElement;
  timeInput.type = 'time';
  timeInput.className = 'card-time';
  timeInput.value = ev.time || '';
  timeInput.addEventListener('change', () => saveEventField(key, ev.id, 'time', timeInput.value));
  timeRow.append(timeLabel, timeInput);

  const notes = document.createElement('textarea');
  notes.className = 'card-notes';
  notes.placeholder = 'Notes…';
  notes.value = ev.notes || '';
  const saveNotes = debounce(() => saveEventField(key, ev.id, 'notes', notes.value.trim()), 400);
  notes.addEventListener('input', saveNotes);

  fields.append(timeRow, notes);
  card.append(toolbar, imgArea, fields);
  return card;
}
