function setScheduleAmPm(ampm: AmPm): void {
  clockAmPm = ampm;
  (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>)
    .forEach(btn => btn.classList.toggle('active', btn.dataset.ampm === clockAmPm));
}

function getScheduleBlocksForDate(key: string): (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean })[] {
  const allDateBlocks = getDayData(key)?.timeBlocks || [];
  const recurBlocks = getRecurringBlocksForDate(key).map(block => ({
    ...block,
    completed: block.completedDates?.includes(key) || false,
    _recurring: true,
  }));
  return [...allDateBlocks, ...recurBlocks];
}

function getScheduleBlockByIdForDate(key: string, blockId: string): (TimeBlock & { _recurring?: boolean; recurrence?: string }) | null {
  return getScheduleBlocksForDate(key).find(block => block.id === blockId) as
    | (TimeBlock & { _recurring?: boolean; recurrence?: string })
    | undefined
    || null;
}

function getStoredBlockById(key: string, blockId: string): TimeBlock | RecurringBlock | null {
  const dayBlock = getDayData(key)?.timeBlocks?.find(block => block.id === blockId);
  if (dayBlock) return dayBlock;
  return (calData._recurring || []).find(block => block.id === blockId) || null;
}

function isSelectedScheduleBlock(key: string, blockId: string): boolean {
  return selectedScheduleBlock?.key === key && selectedScheduleBlock.blockId === blockId;
}

function selectScheduleBlock(key: string, blockId: string): void {
  selectedScheduleBlock = { key, blockId };
  if (activeView === 'schedule' && scheduleDate === key) renderScheduleView(key);
}

function openScheduleBlockEditor(key: string, blockId: string): void {
  const block = getScheduleBlockByIdForDate(key, blockId);
  if (!block) return;
  selectedScheduleBlock = { key, blockId };
  clockAmPm = block.ampm;
  scheduleViewMode = 'daily';
  syncScheduleModeButtons();
  renderScheduleView(key);
  const svg = qId('clock-area').querySelector('svg') as SVGSVGElement | null;
  if (!svg) return;
  showTimeBlockPopup('edit', block, key, svg, 200, 200, 170);
}

function syncScheduleModeButtons(): void {
  (document.querySelectorAll('.schedule-mode-btn') as NodeListOf<HTMLElement>).forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === scheduleViewMode)
  );
  qId('daily-mode-panel').classList.toggle('hidden', scheduleViewMode !== 'daily');
  qId('timeline-mode-panel').classList.toggle('hidden', scheduleViewMode !== 'schedule');
  qId('schedule-scale-group').classList.toggle('hidden', scheduleViewMode !== 'schedule');
}

function setScheduleViewMode(mode: ScheduleViewMode): void {
  scheduleViewMode = mode;
  syncScheduleModeButtons();
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}

function getTimelineAbsoluteMinutes(block: { startMin: number; endMin: number; ampm: AmPm }): { start: number; end: number } {
  const start = (block.ampm === 'PM' ? 12 * 60 : 0) + block.startMin;
  let end = (getBlockEndAmPm(block) === 'PM' ? 12 * 60 : 0) + block.endMin;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

function snapTimelineMinutes(value: number): number {
  return Math.round(value / 15) * 15;
}

function clampTimelineMinutes(value: number): number {
  return Math.max(0, Math.min(24 * 60, snapTimelineMinutes(value)));
}

function applyAbsoluteMinutesToTimeBlock(block: TimeBlock | RecurringBlock, start: number, end: number): void {
  const clampedStart = Math.max(0, Math.min(start, 24 * 60));
  const clampedEnd = Math.max(clampedStart + 15, Math.min(end, 24 * 60));
  block.ampm = clampedStart >= 12 * 60 ? 'PM' : 'AM';
  block.startMin = clampedStart % 720;
  block.endMin = clampedEnd % 720;
}

function getTimelineSegmentsForDate(key: string): TimelineSegment[] {
  const dayBlocks = getDayData(key)?.timeBlocks || [];
  const recurringBlocks = getRecurringBlocksForDate(key);

  return [...dayBlocks, ...recurringBlocks]
    .map(block => {
      const range = getTimelineAbsoluteMinutes(block);
      const recurring = 'recurrence' in block;
      return {
        block,
        recurring,
        completed: recurring
          ? block.completedDates?.includes(key) || false
          : block.completed,
        start: range.start,
        end: range.end,
      };
    })
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.end !== b.end) return a.end - b.end;
      return a.block.label.localeCompare(b.block.label);
    });
}

function resizeScheduleTimelineBoundaryInMemory(
  key: string,
  state: Pick<TimelineResizeState, 'kind' | 'leftBlockId' | 'rightBlockId'>,
  proposedAbsoluteMinutes: number
): boolean {
  const minDuration = 15;
  const proposed = clampTimelineMinutes(proposedAbsoluteMinutes);
  const segments = getTimelineSegmentsForDate(key);
  if (!segments.length) return false;

  if (state.kind === 'leading') {
    const first = segments.find(segment => segment.block.id === state.rightBlockId);
    if (!first) return false;
    const desiredStart = Math.max(0, Math.min(proposed, first.end - minDuration));
    if (desiredStart === first.start) return false;
    applyAbsoluteMinutesToTimeBlock(first.block, desiredStart, first.end);
    return true;
  }

  if (state.kind === 'trailing') {
    const last = segments.find(segment => segment.block.id === state.leftBlockId);
    if (!last) return false;
    const desiredEnd = Math.min(24 * 60, Math.max(proposed, last.start + minDuration));
    if (desiredEnd === last.end) return false;
    applyAbsoluteMinutesToTimeBlock(last.block, last.start, desiredEnd);
    return true;
  }

  const left = segments.find(segment => segment.block.id === state.leftBlockId);
  const right = segments.find(segment => segment.block.id === state.rightBlockId);
  if (!left || !right) return false;

  const desiredBoundary = Math.max(left.start + minDuration, Math.min(proposed, right.end - minDuration));
  if (desiredBoundary === left.end && desiredBoundary === right.start) return false;

  applyAbsoluteMinutesToTimeBlock(left.block, left.start, desiredBoundary);
  applyAbsoluteMinutesToTimeBlock(right.block, desiredBoundary, right.end);
  return true;
}

function getTimelinePointerMinutes(event: MouseEvent, scroll: HTMLElement, hourWidth: number): number {
  const rect = scroll.getBoundingClientRect();
  const offsetX = event.clientX - rect.left + scroll.scrollLeft;
  return clampTimelineMinutes((offsetX / hourWidth) * 60);
}

function endTimelineResize(commit = true): void {
  if (!timelineResizeState) return;
  const activeKey = timelineResizeState.key;
  timelineResizeState = null;
  suppressNextTimelineBarClick = true;
  window.setTimeout(() => { suppressNextTimelineBarClick = false; }, 0);
  document.body.classList.remove('is-resizing-timeline');
  document.removeEventListener('mousemove', onTimelineResizeMove);
  document.removeEventListener('mouseup', onTimelineResizeEnd);
  if (!commit) return;
  void saveCalendarDataAndRefresh(activeKey, { renderSchedule: true });
}

function onTimelineResizeMove(event: MouseEvent): void {
  if (!timelineResizeState) return;
  const scroll = qId('timeline-body-scroll');
  const nextMinutes = getTimelinePointerMinutes(event, scroll, timelineResizeState.hourWidth);
  const changed = resizeScheduleTimelineBoundaryInMemory(
    timelineResizeState.key,
    timelineResizeState,
    nextMinutes
  );
  if (!changed) return;
  if (activeView === 'schedule' && scheduleDate === timelineResizeState.key) renderScheduleView(timelineResizeState.key);
}

function onTimelineResizeEnd(): void {
  endTimelineResize(true);
}

function beginTimelineResize(
  event: MouseEvent,
  key: string,
  state: Pick<TimelineResizeState, 'kind' | 'leftBlockId' | 'rightBlockId'>,
  hourWidth: number
): void {
  event.preventDefault();
  event.stopPropagation();
  if (timelineResizeState) return;
  pushCalendarSnapshot();
  timelineResizeState = { key, hourWidth, ...state };
  document.body.classList.add('is-resizing-timeline');
  document.addEventListener('mousemove', onTimelineResizeMove);
  document.addEventListener('mouseup', onTimelineResizeEnd);
}

function renderScheduleView(key: string): void {
  scheduleDate = key;
  if (rescheduleBlock && rescheduleBlock._key !== key) rescheduleBlock = null;

  qId('sched-date-label').textContent = formatDisplayDate(key);
  syncScheduleModeButtons();
  const allBlocks = getScheduleBlocksForDate(key);

  if (scheduleViewMode === 'daily') {
    const area = qId('clock-area');
    area.innerHTML = '';

    const visibleBlocks = allBlocks.filter(block => (block as BlockOrPartial & { ampm?: AmPm }).ampm === clockAmPm);
    const clockBlocks = clockAmPm === 'PM'
      ? [
          ...allBlocks
            .filter(block => (block as BlockOrPartial & { ampm?: AmPm }).ampm === 'AM')
            .map(block => ({ ...block, _amOverlay: true })),
          ...visibleBlocks,
        ]
      : visibleBlocks;
    const svg = buildClockSVG(key, clockBlocks as BlockOrPartial[]);
    area.appendChild(svg);
    updateClockHand();

    renderBlockLegend(key, visibleBlocks as (TimeBlock & { _recurring?: boolean })[], svg);
  } else {
    renderScheduleTimeline(key);
  }

  renderTaskList(key, allBlocks as (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean })[]);
  renderScheduleBlockDetailsPanel(key);
  updateRescheduleBanner();
}

function createScheduleSubtaskRow(key: string, blockId: string, task: BlockSubtask): HTMLElement {
  const row = document.createElement('div');
  row.className = 'schedule-subtask-item' + (task.completed ? ' completed' : '');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'schedule-subtask-toggle';
  toggle.title = task.completed ? 'Mark sub-task incomplete' : 'Mark sub-task complete';
  toggle.textContent = task.completed ? '\u21BA' : '\u2713';
  toggle.addEventListener('click', () => void toggleBlockSubtaskCompleted(key, blockId, task.id));

  const label = document.createElement('div');
  label.className = 'schedule-subtask-label';
  label.textContent = task.label;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'schedule-subtask-delete';
  del.title = 'Delete sub-task';
  del.textContent = '\u00D7';
  del.addEventListener('click', () => void deleteBlockSubtask(key, blockId, task.id));

  row.append(toggle, label, del);
  return row;
}

function renderScheduleBlockDetailsPanel(key: string): void {
  const panel = qId('schedule-block-panel');
  const empty = qId('schedule-block-panel-empty');
  const content = qId('schedule-block-panel-content');
  const title = qId('schedule-block-panel-title');
  const meta = qId('schedule-block-panel-meta');
  const list = qId('schedule-subtask-list');
  const emptyTasks = qId('schedule-subtask-empty');
  const input = qId<HTMLInputElement>('schedule-subtask-input');
  const editBtn = qId('schedule-block-edit-btn');

  let block: (TimeBlock & { _recurring?: boolean; recurrence?: string }) | null = null;
  if (selectedScheduleBlock?.key === key) {
    block = getScheduleBlockByIdForDate(key, selectedScheduleBlock.blockId);
  }
  if (!block) {
    if (selectedScheduleBlock?.key === key) selectedScheduleBlock = null;
    panel.classList.remove('has-selection');
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    input.value = '';
    return;
  }

  panel.classList.add('has-selection');
  empty.classList.add('hidden');
  content.classList.remove('hidden');
  title.textContent = block.label;
  meta.textContent = `${formatBlockTimeRange(block)}${block._recurring ? ' • Recurring block' : ''}`;
  editBtn.onclick = () => openScheduleBlockEditor(key, block.id);

  list.innerHTML = '';
  emptyTasks.classList.toggle('hidden', block.subtasks.length !== 0);
  block.subtasks.forEach(task => list.appendChild(createScheduleSubtaskRow(key, block.id, task)));
}

function formatTimelineHourLabel(hour: number): string {
  const normalized = hour % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const displayHour = normalized % 12 || 12;
  return `${displayHour} ${suffix}`;
}

function createTimelineBoundaryHandle(
  leftPx: number,
  label: string,
  key: string,
  state: Pick<TimelineResizeState, 'kind' | 'leftBlockId' | 'rightBlockId'>,
  hourWidth: number,
  extraClass = ''
): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = `timeline-boundary-handle ${extraClass}`.trim();
  handle.style.left = `${leftPx}px`;
  handle.title = label;
  handle.addEventListener('click', (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener('mousedown', (event: MouseEvent) =>
    beginTimelineResize(event, key, state, hourWidth)
  );
  return handle;
}

function renderScheduleTimeline(key: string, _blocks?: (TimeBlock & { _recurring?: boolean })[]): void {
  const header = qId('timeline-hour-header');
  const grid = qId('timeline-grid');
  const bars = qId('timeline-bars');
  const scroll = qId('timeline-body-scroll');
  const empty = qId('timeline-empty');
  const previousScrollLeft = scroll.scrollLeft;
  const hourWidth = 96;
  const totalHours = 24;
  const timelineWidth = hourWidth * totalHours;
  const laneHeight = 54;
  const barHeight = 36;
  const placements = getTimelineSegmentsForDate(key).map(segment => ({
    ...segment,
    start: Math.max(0, Math.min(segment.start, 24 * 60)),
    end: Math.max(segment.start + 15, Math.min(segment.end, 24 * 60)),
  }));
  const bodyHeight = laneHeight;

  header.innerHTML = '';
  grid.innerHTML = '';
  bars.innerHTML = '';
  empty.classList.toggle('hidden', placements.length !== 0);
  qId('timeline-surface').classList.toggle('hidden', placements.length === 0);
  if (!placements.length) return;

  const headerTrack = document.createElement('div');
  headerTrack.className = 'timeline-hour-track';
  headerTrack.style.width = `${timelineWidth}px`;

  for (let hour = 0; hour < totalHours; hour++) {
    const cell = document.createElement('div');
    cell.className = 'timeline-hour-cell';
    cell.style.width = `${hourWidth}px`;
    cell.textContent = formatTimelineHourLabel(hour);
    headerTrack.appendChild(cell);
  }
  header.appendChild(headerTrack);

  grid.style.width = `${timelineWidth}px`;
  bars.style.width = `${timelineWidth}px`;
  grid.style.height = `${bodyHeight}px`;
  bars.style.height = `${bodyHeight}px`;

  for (let hour = 0; hour < totalHours; hour++) {
    const column = document.createElement('div');
    column.className = 'timeline-grid-column';
    column.style.left = `${hour * hourWidth}px`;
    column.style.width = `${hourWidth}px`;
    grid.appendChild(column);
  }

  const row = document.createElement('div');
  row.className = 'timeline-grid-row';
  row.style.top = '0px';
  row.style.height = `${laneHeight}px`;
  grid.appendChild(row);

  placements.forEach(({ block, recurring, completed, start, end }) => {
    const bar = document.createElement('button');
    const widthPx = ((end - start) / 60) * hourWidth;
    const displayLabel = recurring ? `${block.label} (Recurring)` : block.label;
    bar.type = 'button';
    bar.className = 'timeline-bar' +
      (isSelectedScheduleBlock(key, block.id) ? ' is-selected' : '') +
      (completed ? ' is-complete' : '') +
      (recurring ? ' is-recurring' : '') +
      (isPastBlock(block, key) && !completed ? ' is-past' : '') +
      (widthPx < 84 ? ' is-compact' : '') +
      (widthPx < 44 ? ' is-mini' : '');
    bar.style.left = `${(start / 60) * hourWidth}px`;
    bar.style.top = `${(laneHeight - barHeight) / 2}px`;
    bar.style.width = `${widthPx}px`;
    applyBlockGradientStyle(bar, block);
    bar.title = `${displayLabel} - ${formatBlockTimeRange(block)}`;

    const label = document.createElement('span');
    label.className = 'timeline-bar-label';
    label.textContent = displayLabel;
    bar.appendChild(label);

    const time = document.createElement('span');
    time.className = 'timeline-bar-time';
    time.textContent = formatBlockTimeRange(block);
    bar.appendChild(time);

    bar.addEventListener('click', () => {
      if (suppressNextTimelineBarClick) return;
      selectScheduleBlock(key, block.id);
    });

    bars.appendChild(bar);
  });

  if (placements.length) {
    const first = placements[0];
    bars.appendChild(createTimelineBoundaryHandle(
      (first.start / 60) * hourWidth,
      'Drag to adjust the first block start time',
      key,
      { kind: 'leading', rightBlockId: first.block.id },
      hourWidth,
      'is-leading'
    ));

    for (let index = 0; index < placements.length - 1; index++) {
      const left = placements[index];
      const right = placements[index + 1];
      bars.appendChild(createTimelineBoundaryHandle(
        (left.end / 60) * hourWidth,
        'Drag to adjust the shared boundary between adjacent blocks',
        key,
        { kind: 'between', leftBlockId: left.block.id, rightBlockId: right.block.id },
        hourWidth
      ));
    }

    const last = placements[placements.length - 1];
    bars.appendChild(createTimelineBoundaryHandle(
      (last.end / 60) * hourWidth,
      'Drag to adjust the last block end time',
      key,
      { kind: 'trailing', leftBlockId: last.block.id },
      hourWidth,
      'is-trailing'
    ));
  }

  const now = new Date();
  const todayKey = getTodayKey();
  if (key === todayKey) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const marker = document.createElement('div');
    marker.className = 'timeline-now-marker';
    marker.style.left = `${(currentMinutes / 60) * hourWidth}px`;
    marker.style.height = `${bodyHeight}px`;
    bars.appendChild(marker);
  }

  scroll.scrollLeft = timelineResizeState || previousScrollLeft > 0
    ? previousScrollLeft
    : clockAmPm === 'PM' ? hourWidth * 12 : 0;
  headerTrack.style.transform = `translateX(${-scroll.scrollLeft}px)`;
  scroll.onscroll = () => {
    headerTrack.style.transform = `translateX(${-scroll.scrollLeft}px)`;
  };
}

function createTaskActionButton(
  title: string,
  text: string,
  onClick: (event: MouseEvent) => void,
  className = 'task-btn'
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.title = title;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function renderTaskList(key: string, allBlocks: (TimeBlock & { _recurring?: boolean; _amOverlay?: boolean })[]): void {
  const list = qId('task-list');
  list.innerHTML = '';

  if (!allBlocks.length) {
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = scheduleViewMode === 'daily'
      ? 'No blocks scheduled.\nDrag the clock ring to add one.'
      : 'No blocks scheduled.\nUse Daily mode to add one.';
    list.appendChild(empty);
    return;
  }

  const sorted = [...allBlocks].sort((a, b) => {
    const aOrder = (a.ampm === 'PM' ? 720 : 0) + a.startMin;
    const bOrder = (b.ampm === 'PM' ? 720 : 0) + b.startMin;
    return aOrder - bOrder;
  });

  sorted.forEach(block => {
    const past = isPastBlock(block, key) && !block.completed;

    const item = document.createElement('div');
    item.className = 'task-item' +
      (isSelectedScheduleBlock(key, block.id) ? ' selected' : '') +
      (block.completed ? ' completed' : '') +
      (past ? ' past' : '');
    item.addEventListener('click', () => selectScheduleBlock(key, block.id));

    const swatch = document.createElement('div');
    swatch.className = 'task-color-swatch';
    applyBlockGradientStyle(swatch, block);

    const body = document.createElement('div');
    body.className = 'task-body';

    const label = document.createElement('div');
    label.className = 'task-label';
    label.textContent = block.label;
    if (block._recurring) {
      const badge = document.createElement('span');
      badge.className = 'task-recur-badge';
      badge.textContent = '\u21BB';
      label.appendChild(badge);
    }

    const time = document.createElement('div');
    time.className = 'task-time';
    time.textContent = formatBlockTimeRange(block);

    body.append(label, time);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const completeBtn = createTaskActionButton(
      block.completed ? 'Mark incomplete' : 'Mark complete',
      block.completed ? '\u21BA' : '\u2713',
      (event) => {
        event.stopPropagation();
        void toggleBlockCompleted(key, block.id);
      }
    );

    const editBtn = createTaskActionButton('Edit block', '\u270E', (event) => {
      event.stopPropagation();
      openScheduleBlockEditor(key, block.id);
    });

    const rescheduleBtn = createTaskActionButton('Move to another day', '\u29C9', (event) => {
      event.stopPropagation();
      startReschedule(block, key);
    });
    if (block._recurring) rescheduleBtn.style.display = 'none';

    const deleteBtn = createTaskActionButton('Delete block', '\u00D7', (event) => {
      event.stopPropagation();
      if (block._recurring) {
        const todayBtn = createTaskActionButton('Remove just from this day', 'Today', (todayEvent) => {
          todayEvent.stopPropagation();
          void deleteTimeBlock(key, block.id, 'today');
        });
        const allBtn = createTaskActionButton('Remove from all days', 'All', (allEvent) => {
          allEvent.stopPropagation();
          void deleteTimeBlock(key, block.id, 'all');
        }, 'task-btn task-btn-del');
        const cancelBtn = createTaskActionButton('Cancel', '\u21A9', (cancelEvent) => {
          cancelEvent.stopPropagation();
          if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
        });
        actions.innerHTML = '';
        actions.append(todayBtn, allBtn, cancelBtn);
        return;
      }
      void deleteTimeBlock(key, block.id);
    }, 'task-btn task-btn-del');

    actions.append(completeBtn, editBtn, rescheduleBtn, deleteBtn);
    item.append(swatch, body, actions);
    list.appendChild(item);
  });
}

function isPastBlock(block: TimeBlock | RecurringBlock | (BlockOrPartial & { ampm?: AmPm }), key: string): boolean {
  const todayKey = getTodayKey();
  if (key < todayKey) return true;
  if (key > todayKey) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const ampm = (block as BlockOrPartial & { ampm?: AmPm }).ampm;
  let endMin = ampm === 'PM' ? block.endMin + 720 : block.endMin;
  if (ampm === 'AM' && block.endMin < block.startMin) endMin = block.endMin + 720;
  return nowMin >= endMin;
}

async function toggleBlockCompleted(key: string, blockId: string): Promise<void> {
  pushCalendarSnapshot();
  const recurringBlock = (calData._recurring || []).find(block => block.id === blockId);
  if (recurringBlock) {
    if (!recurringBlock.completedDates) recurringBlock.completedDates = [];
    const index = recurringBlock.completedDates.indexOf(key);
    if (index === -1) recurringBlock.completedDates.push(key);
    else recurringBlock.completedDates.splice(index, 1);
    await saveCalendarDataAndRefresh(key, { renderCurrentSchedule: true });
    return;
  }
  const block = getDayData(key)?.timeBlocks?.find(entry => entry.id === blockId);
  if (!block) return;
  block.completed = !block.completed;
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

async function addBlockSubtask(key: string, blockId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const block = getStoredBlockById(key, blockId);
  if (!block) return;
  pushCalendarSnapshot();
  if (!Array.isArray(block.subtasks)) block.subtasks = [];
  block.subtasks.push({
    id: generateCalendarEntryId(),
    label: trimmed,
    completed: false,
  });
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

async function toggleBlockSubtaskCompleted(key: string, blockId: string, subtaskId: string): Promise<void> {
  const block = getStoredBlockById(key, blockId);
  const task = block?.subtasks?.find(entry => entry.id === subtaskId);
  if (!block || !task) return;
  pushCalendarSnapshot();
  task.completed = !task.completed;
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

async function deleteBlockSubtask(key: string, blockId: string, subtaskId: string): Promise<void> {
  const block = getStoredBlockById(key, blockId);
  if (!block?.subtasks?.some(entry => entry.id === subtaskId)) return;
  pushCalendarSnapshot();
  block.subtasks = block.subtasks.filter(entry => entry.id !== subtaskId);
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

function startReschedule(block: TimeBlock & { _recurring?: boolean }, key: string): void {
  rescheduleBlock = { ...block, _key: key };
  updateRescheduleBanner();
  renderScheduleView(key);
}

function updateRescheduleBanner(): void {
  const banner = qId('reschedule-banner');
  if (!rescheduleBlock) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  qId('reschedule-label').textContent = rescheduleBlock.label;

  const input = qId<HTMLInputElement>('reschedule-date-input');
  if (!input.value) {
    const [year, month, day] = rescheduleBlock._key.split('-').map(Number);
    const nextDate = new Date(year, month - 1, day + 1);
    input.value = dateKey(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
  }
}

async function confirmReschedule(): Promise<void> {
  if (!rescheduleBlock) return;
  pushCalendarSnapshot();
  const input = qId<HTMLInputElement>('reschedule-date-input');
  const newKey = input.value;
  if (!newKey || newKey === rescheduleBlock._key) {
    cancelReschedule();
    return;
  }

  const { id, startMin, endMin, label, ampm, completed, subtasks, _key: oldKey } = rescheduleBlock;
  const appearance = getBlockStorageAppearance(rescheduleBlock);

  const oldDay = getDayData(oldKey);
  if (oldDay?.timeBlocks) {
    oldDay.timeBlocks = oldDay.timeBlocks.filter(block => block.id !== id);
    if (!oldDay.timeBlocks.length && !oldDay.events?.length) delete calData[oldKey];
  }

  const newDay = getOrInitDayData(newKey);
  newDay.timeBlocks.push({
    id,
    startMin,
    endMin,
    label,
    ...appearance,
    ampm,
    completed: completed || false,
    subtasks: [...(subtasks || [])],
  });

  rescheduleBlock = null;
  await saveCalendarDataAndRefresh(scheduleDate!, { renderSchedule: true });
}

function cancelReschedule(): void {
  rescheduleBlock = null;
  document.getElementById('reschedule-banner')?.classList.add('hidden');
  qId<HTMLInputElement>('reschedule-date-input').value = '';
  if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
}
