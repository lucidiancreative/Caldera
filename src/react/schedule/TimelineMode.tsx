import { useEffect, useRef, useState } from 'react';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import {
  deleteBlock,
  moveBlockToDate,
  moveRecurringOccurrenceToOneOff,
  updateBlockOccurrenceTimesBatch,
} from '../store/actions';
import { getScheduleBlocksForDate, isBlockPast } from '../store/selectors';
import {
  absoluteMinutesToBlockTimes,
  clientXToTimelineMinutes,
  getTimelineZoomScrollLeft,
  getTimelineResizePlan,
  moveTimelineRange,
  packTimelineDay,
  type TimelineDaySegment,
} from './timeline';
import { TASK_DND_MIME, isTaskDrag } from './taskDnd';
import {
  formatBlockTimeRange,
  formatMonthDayLabel,
  formatWeekdayLabel,
  getTodayKey,
  getWeekDateKeys,
  getWeekStartKey,
} from '../util/format';

const DEFAULT_HOUR_WIDTH = 96;
const MIN_HOUR_WIDTH = 64;
const MAX_HOUR_WIDTH = 176;
const HOUR_WIDTH_STEP = 16;
const TOTAL_HOURS = 24;
const LANE_HEIGHT = 62;
const BAR_HEIGHT = 52;
const DAY_LABEL_WIDTH = 104;
const TIMELINE_VIEWPORT_STORAGE_KEY = 'caldera.weekTimeline.viewport.v1';

function hourLabel(hour: number): string {
  const n = hour % 24;
  return `${n % 12 || 12} ${n >= 12 ? 'PM' : 'AM'}`;
}

interface TimelineModeProps {
  date: string;
  selection: { date: string; blockId: string } | null;
  onFocusDate: (date: string, options?: { preserveSelection?: boolean }) => void;
  onSelect: (selection: { date: string; blockId: string }) => void;
  onClearSelection: () => void;
  onCreate: (draft: { date: string; startMin: number; endMin: number; ampm: 'AM' | 'PM' }) => void;
  onScheduleTask: (taskId: string, draft: { date: string; startMin: number; endMin: number; ampm: 'AM' | 'PM' }) => void;
}

interface SegmentOverride {
  start: number;
  end: number;
}

interface CreatePreview {
  date: string;
  start: number;
  end: number;
  lane: number;
}

// A whole-block move in progress. `targetDate === sourceDate` is a same-day reposition
// (the source bar slides live); a different `targetDate` is a cross-day move (the source
// bar dims and a ghost previews where it will land on the target row).
interface MovePreview {
  blockId: string;
  sourceDate: string;
  targetDate: string;
  start: number;
  end: number;
}

interface PersistedTimelineViewport {
  hourWidth: number;
  scrollLeft: number;
  scrollTop: number;
}

function clampHourWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_HOUR_WIDTH, Math.min(MAX_HOUR_WIDTH, value))
    : DEFAULT_HOUR_WIDTH;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function readTimelineViewport(): PersistedTimelineViewport {
  try {
    const raw = window.localStorage.getItem(TIMELINE_VIEWPORT_STORAGE_KEY);
    if (!raw) return { hourWidth: DEFAULT_HOUR_WIDTH, scrollLeft: 0, scrollTop: 0 };
    const parsed = JSON.parse(raw) as Partial<PersistedTimelineViewport>;
    return {
      hourWidth: clampHourWidth(parsed.hourWidth),
      scrollLeft: finiteNumber(parsed.scrollLeft, 0),
      scrollTop: finiteNumber(parsed.scrollTop, 0),
    };
  } catch {
    return { hourWidth: DEFAULT_HOUR_WIDTH, scrollLeft: 0, scrollTop: 0 };
  }
}

function saveTimelineViewport(viewport: PersistedTimelineViewport): void {
  try {
    window.localStorage.setItem(TIMELINE_VIEWPORT_STORAGE_KEY, JSON.stringify(viewport));
  } catch {
    // View persistence is a convenience; keep the timeline usable if storage is unavailable.
  }
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('.rblock-editor, #modal, #settings-modal, #ai-modal, #ai-review-modal')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function TimelineMode({ date, selection, onFocusDate, onSelect, onClearSelection, onCreate, onScheduleTask }: TimelineModeProps) {
  const calData = useCalData();
  useMinuteTick();
  const appearance = window.calderaAppearance;
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredViewportRef = useRef(false);
  const pendingZoomScrollLeftRef = useRef<number | null>(null);
  const previousWeekRef = useRef(getWeekStartKey(date));
  const interactionControllerRef = useRef<AbortController | null>(null);
  const [hourWidth, setHourWidth] = useState(() => readTimelineViewport().hourWidth);
  const [previewByOccurrenceKey, setPreviewByOccurrenceKey] = useState<Record<string, SegmentOverride>>({});
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const totalWidth = hourWidth * TOTAL_HOURS;
  const zoomPercent = Math.round((hourWidth / DEFAULT_HOUR_WIDTH) * 100);
  const now = new Date();
  const todayKey = getTodayKey();
  const weekDates = getWeekDateKeys(date);
  const week = weekDates.map((dayKey) => {
    const { segments, laneCount } = packTimelineDay(dayKey, getScheduleBlocksForDate(calData, dayKey));
    return {
      date: dayKey,
      segments,
      laneCount,
      height: Math.max(LANE_HEIGHT, laneCount * LANE_HEIGHT),
    };
  });
  const dayByDate = new Map(week.map((day) => [day.date, day]));
  const baseSegments = week.flatMap((day) => day.segments);
  const totalSegments = baseSegments.length;
  const firstStart = baseSegments.length
    ? Math.min(...baseSegments.map((segment) => segment.start))
    : 0;

  useEffect(() => () => interactionControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!selection) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return;
      if (event.defaultPrevented || isEditableKeyTarget(event.target)) return;
      if (getWeekStartKey(selection.date) !== getWeekStartKey(date)) return;
      const selectedBlock = getScheduleBlocksForDate(calData, selection.date).find((block) => block.id === selection.blockId);
      if (!selectedBlock) return;
      event.preventDefault();
      onClearSelection();
      void deleteBlock(selection.date, selection.blockId, selectedBlock.recurring ? 'today' : undefined);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [calData, date, onClearSelection, selection]);

  useEffect(() => {
    if (restoredViewportRef.current) return;
    restoredViewportRef.current = true;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const viewport = readTimelineViewport();
    scroll.scrollLeft = viewport.scrollLeft;
    scroll.scrollTop = viewport.scrollTop;
  }, []);

  useEffect(() => {
    const pendingScrollLeft = pendingZoomScrollLeftRef.current;
    if (pendingScrollLeft === null) return;
    pendingZoomScrollLeftRef.current = null;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    scroll.scrollLeft = Math.min(pendingScrollLeft, maxScrollLeft);
    saveTimelineViewport({
      hourWidth,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
    });
  }, [hourWidth]);

  useEffect(() => {
    const currentWeek = getWeekStartKey(date);
    if (currentWeek === previousWeekRef.current) return;
    previousWeekRef.current = currentWeek;
    setPreviewByOccurrenceKey({});
    setCreatePreview(null);
    setMovePreview(null);
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, (firstStart / 60) * hourWidth - hourWidth / 2);
      scrollRef.current.scrollTop = 0;
      saveTimelineViewport({
        hourWidth,
        scrollLeft: scrollRef.current.scrollLeft,
        scrollTop: 0,
      });
    }
  }, [date, firstStart, hourWidth]);

  function persistCurrentViewport(nextHourWidth = hourWidth) {
    const scroll = scrollRef.current;
    if (!scroll) return;
    saveTimelineViewport({
      hourWidth: nextHourWidth,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
    });
  }

  function changeZoom(delta: number) {
    const nextHourWidth = clampHourWidth(hourWidth + delta);
    if (nextHourWidth === hourWidth) return;
    const scroll = scrollRef.current;
    if (scroll) {
      pendingZoomScrollLeftRef.current = getTimelineZoomScrollLeft(
        scroll.scrollLeft,
        scroll.clientWidth,
        hourWidth,
        nextHourWidth,
        DAY_LABEL_WIDTH,
      );
    }
    setHourWidth(nextHourWidth);
  }

  function pointerToMinutes(clientX: number, track: HTMLElement): number {
    const rect = track.getBoundingClientRect();
    return clientXToTimelineMinutes(clientX, rect.left, hourWidth);
  }

  function pointerToLane(clientY: number, track: HTMLElement, laneCount: number): number {
    const rect = track.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const lane = Math.floor(offsetY / LANE_HEIGHT);
    return Math.max(0, Math.min(lane, Math.max(0, laneCount - 1)));
  }

  // Which day row the cursor is over, by hit-testing the element under it. Day tracks all
  // share the same horizontal origin, so only the row (clientY) decides the destination;
  // previews and the now-marker are pointer-events:none, so this lands on the track itself.
  function dayDateUnderPointer(clientX: number, clientY: number): string | null {
    const element = document.elementFromPoint(clientX, clientY);
    const track = element?.closest('.rtimeline-daytrack');
    return track instanceof HTMLElement ? track.dataset.date ?? null : null;
  }

  function beginResize(
    pointerEvent: React.PointerEvent<HTMLButtonElement>,
    segment: TimelineDaySegment,
    edge: 'start' | 'end',
  ) {
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();

    const day = dayByDate.get(segment.date);
    if (!day) return;

    const plan = getTimelineResizePlan(day.segments, segment.block.id, edge);
    if (!plan) return;

    const targetSegment = day.segments.find((entry) => entry.block.id === plan.blockId);
    const linkedSegment = plan.linkedBlockId ? day.segments.find((entry) => entry.block.id === plan.linkedBlockId) : null;
    const track = pointerEvent.currentTarget.closest('.rtimeline-daytrack');
    if (!targetSegment || !track || !(track instanceof HTMLElement)) return;

    interactionControllerRef.current?.abort();
    const controller = new AbortController();
    interactionControllerRef.current = controller;
    let latestPreview: Record<string, SegmentOverride> = {};

    document.body.classList.add('is-resizing-timeline');

    const onMove = (moveEvent: PointerEvent) => {
      const boundary = Math.max(plan.minBoundary, Math.min(pointerToMinutes(moveEvent.clientX, track), plan.maxBoundary));
      latestPreview = plan.edge === 'start'
        ? {
            [targetSegment.occurrenceKey]: { start: boundary, end: targetSegment.end },
            ...(linkedSegment ? { [linkedSegment.occurrenceKey]: { start: linkedSegment.start, end: boundary } } : {}),
          }
        : {
            [targetSegment.occurrenceKey]: { start: targetSegment.start, end: boundary },
            ...(linkedSegment ? { [linkedSegment.occurrenceKey]: { start: boundary, end: linkedSegment.end } } : {}),
          };
      setPreviewByOccurrenceKey(latestPreview);
    };

    const onUp = () => {
      controller.abort();
      interactionControllerRef.current = null;
      document.body.classList.remove('is-resizing-timeline');

      const updates = Object.entries(latestPreview).map(([occurrenceKey, preview]) => {
        const currentSegment = day.segments.find((entry) => entry.occurrenceKey === occurrenceKey);
        if (!currentSegment) return null;
        const nextTimes = absoluteMinutesToBlockTimes(preview.start, preview.end);
        return {
          blockId: currentSegment.block.id,
          startMin: nextTimes.startMin,
          endMin: nextTimes.endMin,
          ampm: nextTimes.ampm,
        };
      }).filter((entry): entry is {
        blockId: string;
        startMin: number;
        endMin: number;
        ampm: 'AM' | 'PM';
      } => !!entry);

      setPreviewByOccurrenceKey({});
      if (updates.length > 0) {
        void updateBlockOccurrenceTimesBatch(calData, targetSegment.date, updates).then((mappings) => {
          const selected = mappings.find((mapping) => mapping.blockId === targetSegment.block.id);
          onSelect({ date: targetSegment.date, blockId: selected?.nextBlockId ?? targetSegment.block.id });
        });
      } else {
        onSelect({ date: targetSegment.date, blockId: targetSegment.block.id });
      }
    };

    document.addEventListener('pointermove', onMove, { signal: controller.signal });
    document.addEventListener('pointerup', onUp, { signal: controller.signal, once: true });
  }

  function beginCreate(pointerEvent: React.PointerEvent<HTMLDivElement>, dayDate: string, laneCount: number) {
    const target = pointerEvent.target as HTMLElement;
    if (target.closest('.timeline-bar')) return;

    const track = pointerEvent.currentTarget;
    pointerEvent.preventDefault();
    const start = pointerToMinutes(pointerEvent.clientX, track);
    const lane = pointerToLane(pointerEvent.clientY, track, laneCount);

    interactionControllerRef.current?.abort();
    const controller = new AbortController();
    interactionControllerRef.current = controller;
    let latestStart = start;
    let latestEnd = start;
    let latestLane = lane;
    setCreatePreview({ date: dayDate, start, end: start, lane });

    const onMove = (moveEvent: PointerEvent) => {
      latestEnd = pointerToMinutes(moveEvent.clientX, track);
      latestLane = pointerToLane(moveEvent.clientY, track, laneCount);
      setCreatePreview({
        date: dayDate,
        start: Math.min(latestStart, latestEnd),
        end: Math.max(latestStart, latestEnd),
        lane: latestLane,
      });
    };

    const onUp = () => {
      controller.abort();
      interactionControllerRef.current = null;
      setCreatePreview(null);

      const startAbs = Math.min(latestStart, latestEnd);
      const endAbs = Math.max(latestStart, latestEnd);
      if (endAbs - startAbs < 15) return;
      const nextTimes = absoluteMinutesToBlockTimes(startAbs, endAbs);
      onCreate({
        date: dayDate,
        startMin: nextTimes.startMin,
        endMin: nextTimes.endMin,
        ampm: nextTimes.ampm,
      });
    };

    document.addEventListener('pointermove', onMove, { signal: controller.signal });
    document.addEventListener('pointerup', onUp, { signal: controller.signal, once: true });
  }

  function beginMove(pointerEvent: React.PointerEvent<HTMLDivElement>, segment: TimelineDaySegment) {
    const target = pointerEvent.target as HTMLElement;
    if (target.closest('.timeline-boundary-handle')) return;

    const track = pointerEvent.currentTarget.parentElement;
    if (!track) return;

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();

    interactionControllerRef.current?.abort();
    const controller = new AbortController();
    interactionControllerRef.current = controller;
    const anchorMinutes = pointerToMinutes(pointerEvent.clientX, track);
    const anchorClientX = pointerEvent.clientX;
    let didDrag = false;
    let latestRange: SegmentOverride | null = null;
    let latestTargetDate = segment.date;

    document.body.classList.add('is-dragging-timeline-block');

    const onMove = (moveEvent: PointerEvent) => {
      // x→minutes is day-independent (tracks share an origin), so reuse the source track;
      // the row under the cursor is what picks the destination day.
      const dragDelta = pointerToMinutes(moveEvent.clientX, track) - anchorMinutes;
      const nextRange = moveTimelineRange(segment.start, segment.end, dragDelta);
      const targetDate = dayDateUnderPointer(moveEvent.clientX, moveEvent.clientY) ?? segment.date;

      if (
        !didDrag &&
        Math.abs(moveEvent.clientX - anchorClientX) < 3 &&
        nextRange.start === segment.start &&
        nextRange.end === segment.end &&
        targetDate === segment.date
      ) {
        return;
      }

      didDrag = true;
      latestRange = nextRange;
      latestTargetDate = targetDate;
      setMovePreview({
        blockId: segment.block.id,
        sourceDate: segment.date,
        targetDate,
        start: nextRange.start,
        end: nextRange.end,
      });
    };

    const onUp = () => {
      controller.abort();
      interactionControllerRef.current = null;
      document.body.classList.remove('is-dragging-timeline-block');
      setMovePreview(null);

      if (!didDrag || !latestRange) {
        onSelect({ date: latestTargetDate, blockId: segment.block.id });
        return;
      }

      const nextTimes = absoluteMinutesToBlockTimes(latestRange.start, latestRange.end);
      if (segment.block.recurring) {
        void moveRecurringOccurrenceToOneOff(calData, segment.date, segment.block.id, latestTargetDate, nextTimes)
          .then((nextSelection) => {
            onSelect(nextSelection ?? { date: latestTargetDate, blockId: segment.block.id });
          });
      } else if (latestTargetDate !== segment.date) {
        onSelect({ date: latestTargetDate, blockId: segment.block.id });
        void moveBlockToDate(calData, segment.date, segment.block.id, latestTargetDate, nextTimes);
      } else {
        onSelect({ date: latestTargetDate, blockId: segment.block.id });
        void updateBlockOccurrenceTimesBatch(calData, segment.date, [
          {
            blockId: segment.block.id,
            startMin: nextTimes.startMin,
            endMin: nextTimes.endMin,
            ampm: nextTimes.ampm,
          },
        ]);
      }
    };

    document.addEventListener('pointermove', onMove, { signal: controller.signal });
    document.addEventListener('pointerup', onUp, { signal: controller.signal, once: true });
  }

  // Drop an inbox task onto a day row → a default 60-minute block at the hovered time. The
  // x→minutes mapping and the absolute→AM/PM conversion are exactly the drag-create path's,
  // so a dropped block is indistinguishable from one drawn by hand.
  function onDayDragOver(event: React.DragEvent<HTMLDivElement>, dayDate: string) {
    // preventDefault unconditionally — this is what actually allows the drop to fire
    // (same as TabBar/CalendarView). isTaskDrag only gates the hover highlight.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (isTaskDrag(event.dataTransfer) && dropTargetDate !== dayDate) setDropTargetDate(dayDate);
  }

  function onDayDragLeave(event: React.DragEvent<HTMLDivElement>) {
    // Ignore leaves into child elements (bars, gridlines) so the highlight doesn't flicker.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropTargetDate(null);
  }

  function onDayDrop(event: React.DragEvent<HTMLDivElement>, dayDate: string) {
    const taskId = event.dataTransfer.getData(TASK_DND_MIME);
    setDropTargetDate(null);
    if (!taskId) return;
    event.preventDefault();
    const startAbs = Math.min(pointerToMinutes(event.clientX, event.currentTarget), 24 * 60 - 60);
    const times = absoluteMinutesToBlockTimes(startAbs, startAbs + 60);
    onScheduleTask(taskId, { date: dayDate, startMin: times.startMin, endMin: times.endMin, ampm: times.ampm });
  }

  return (
    <div className="rtimeline">
      <div className="rtimeline-toolbar">
        <div className="rtimeline-zoom" aria-label="Week timeline zoom">
          <button
            type="button"
            className="rtimeline-zoom-btn"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={hourWidth <= MIN_HOUR_WIDTH}
            onClick={() => changeZoom(-HOUR_WIDTH_STEP)}
          >
            -
          </button>
          <span className="rtimeline-zoom-value" aria-label="Current zoom">{zoomPercent}%</span>
          <button
            type="button"
            className="rtimeline-zoom-btn"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={hourWidth >= MAX_HOUR_WIDTH}
            onClick={() => changeZoom(HOUR_WIDTH_STEP)}
          >
            +
          </button>
        </div>
      </div>
      <div className="rtimeline-scroll" ref={scrollRef} onScroll={() => persistCurrentViewport()}>
        <div className="rtimeline-sheet" style={{ minWidth: totalWidth + DAY_LABEL_WIDTH }}>
          <div className="rtimeline-header">
            <div className="rtimeline-dayhead" />
            <div className="rtimeline-hours" style={{ width: totalWidth }}>
              {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
                <div key={hour} className="rtimeline-hour" style={{ width: hourWidth }}>{hourLabel(hour)}</div>
              ))}
            </div>
          </div>

          <div className="rtimeline-week">
            {week.map((day) => (
              <div
                key={day.date}
                className={
                  'rtimeline-dayrow' +
                  (day.date === date ? ' is-active' : '') +
                  (day.date === todayKey ? ' is-today' : '')
                }
              >
                <button
                  type="button"
                  className="rtimeline-daylabel"
                  onClick={() => onFocusDate(day.date)}
                  title={day.date === date ? 'Focused day' : 'Focus this day'}
                >
                  <span className="rtimeline-dayname">{formatWeekdayLabel(day.date)}</span>
                  <span className="rtimeline-daydate">{formatMonthDayLabel(day.date)}</span>
                </button>

                <div
                  className={
                    'rtimeline-daytrack' +
                    // Same accent highlight for an inbox-task drop and a cross-day block move.
                    ((dropTargetDate === day.date ||
                      (!!movePreview && movePreview.sourceDate !== movePreview.targetDate && movePreview.targetDate === day.date))
                      ? ' is-drop-target'
                      : '')
                  }
                  data-date={day.date}
                  style={{ width: totalWidth, height: day.height }}
                  onPointerDown={(event) => beginCreate(event, day.date, day.laneCount)}
                  onDragEnter={(event) => event.preventDefault()}
                  onDragOver={(event) => onDayDragOver(event, day.date)}
                  onDragLeave={onDayDragLeave}
                  onDrop={(event) => onDayDrop(event, day.date)}
                >
                  {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
                    <div key={hour} className="rtimeline-gridline" style={{ left: hour * hourWidth }} />
                  ))}

                  {!day.segments.length && totalSegments > 0 && (
                    <div className="rtimeline-dayempty">No scheduled blocks</div>
                  )}

                  {day.segments.map((segment) => {
                    const resizePreview = previewByOccurrenceKey[segment.occurrenceKey];
                    const isMoveSource = movePreview?.blockId === segment.block.id && movePreview.sourceDate === segment.date;
                    const movingAway = isMoveSource && movePreview!.targetDate !== segment.date;
                    // A same-day move slides this bar live; a cross-day move leaves it dimmed in
                    // place while the ghost on the target row previews where it will land.
                    const sameDayMove = isMoveSource && !movingAway ? movePreview! : null;
                    const start = resizePreview?.start ?? sameDayMove?.start ?? segment.start;
                    const end = resizePreview?.end ?? sameDayMove?.end ?? segment.end;
                    const widthPx = ((end - start) / 60) * hourWidth;
                    const past = isBlockPast(segment.block, day.date, now, todayKey) && !segment.block.completed;
                    const label = segment.block.recurring ? `${segment.block.label} (Recurring)` : segment.block.label;
                    const selected = selection?.date === day.date && selection.blockId === segment.block.id;

                    return (
                      <div
                        key={segment.occurrenceKey}
                        className={
                          'timeline-bar' +
                          (selected ? ' is-selected' : '') +
                          (segment.block.completed ? ' is-complete' : '') +
                          (segment.block.recurring ? ' is-recurring' : '') +
                          (segment.block.deadline ? ' is-deadline' : '') +
                          (past ? ' is-past' : '') +
                          (movingAway ? ' is-moving-away' : '') +
                          (widthPx < 84 ? ' is-compact' : '') +
                          (widthPx < 44 ? ' is-mini' : '')
                        }
                        style={{
                          left: (start / 60) * hourWidth,
                          top: segment.lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
                          width: widthPx,
                          height: BAR_HEIGHT,
                          background: appearance?.gradientCss(segment.block) ?? segment.block.color,
                        }}
                        title={`${label} - ${formatBlockTimeRange(segment.block)}`}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(event) => beginMove(event, segment)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onSelect({ date: day.date, blockId: segment.block.id });
                          }
                        }}
                      >
                        <span className="timeline-bar-label">{label}</span>
                        <span className="timeline-bar-time">{formatBlockTimeRange(segment.block)}</span>
                        <button
                          type="button"
                          className="timeline-boundary-handle is-leading"
                          style={{ left: 0 }}
                          title="Drag to adjust the block start time"
                          onPointerDown={(event) => beginResize(event, segment, 'start')}
                        />
                        <button
                          type="button"
                          className="timeline-boundary-handle is-trailing"
                          style={{ left: widthPx }}
                          title="Drag to adjust the block end time"
                          onPointerDown={(event) => beginResize(event, segment, 'end')}
                        />
                      </div>
                    );
                  })}

                  {createPreview?.date === day.date && createPreview.end - createPreview.start >= 15 && (
                    <div
                      className="timeline-bar is-preview"
                      style={{
                        left: (createPreview.start / 60) * hourWidth,
                        top: createPreview.lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
                        width: ((createPreview.end - createPreview.start) / 60) * hourWidth,
                        height: BAR_HEIGHT,
                      }}
                    />
                  )}

                  {movePreview && movePreview.targetDate === day.date && movePreview.sourceDate !== day.date && (
                    <div
                      className="timeline-bar is-preview"
                      style={{
                        left: (movePreview.start / 60) * hourWidth,
                        top: (LANE_HEIGHT - BAR_HEIGHT) / 2,
                        width: ((movePreview.end - movePreview.start) / 60) * hourWidth,
                        height: BAR_HEIGHT,
                      }}
                    />
                  )}

                  {day.date === todayKey && (
                    <div
                      className="timeline-now-marker"
                      style={{ left: (now.getHours() * 60 + now.getMinutes()) / 60 * hourWidth, height: day.height }}
                    />
                  )}
                </div>
              </div>
            ))}

            {!totalSegments && !createPreview && (
              <div className="rtimeline-empty">
                No scheduled blocks this week. Drag across any day row to add one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
