import { useEffect, useRef, useState } from 'react';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import { updateBlockTimesBatch } from '../store/actions';
import { getScheduleBlocksForDate, isBlockPast } from '../store/selectors';
import {
  absoluteMinutesToBlockTimes,
  getTimelineResizePlan,
  moveTimelineRange,
  packTimelineDay,
  type TimelineDaySegment,
} from './timeline';
import {
  formatBlockTimeRange,
  formatMonthDayLabel,
  formatWeekdayLabel,
  getTodayKey,
  getWeekDateKeys,
  getWeekStartKey,
} from '../util/format';

const HOUR_WIDTH = 96;
const TOTAL_HOURS = 24;
const LANE_HEIGHT = 48;
const BAR_HEIGHT = 38;
const DAY_LABEL_WIDTH = 104;

function hourLabel(hour: number): string {
  const n = hour % 24;
  return `${n % 12 || 12} ${n >= 12 ? 'PM' : 'AM'}`;
}

function snapTimelineMinutes(value: number): number {
  return Math.round(value / 15) * 15;
}

function clampTimelineMinutes(value: number): number {
  return Math.max(0, Math.min(24 * 60, snapTimelineMinutes(value)));
}

interface TimelineModeProps {
  date: string;
  selection: { date: string; blockId: string } | null;
  onFocusDate: (date: string, options?: { preserveSelection?: boolean }) => void;
  onSelect: (selection: { date: string; blockId: string }) => void;
  onCreate: (draft: { date: string; startMin: number; endMin: number; ampm: 'AM' | 'PM' }) => void;
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

export function TimelineMode({ date, selection, onFocusDate, onSelect, onCreate }: TimelineModeProps) {
  const calData = useCalData();
  useMinuteTick();
  const appearance = window.calderaAppearance;
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousWeekRef = useRef(getWeekStartKey(date));
  const interactionControllerRef = useRef<AbortController | null>(null);
  const [previewByOccurrenceKey, setPreviewByOccurrenceKey] = useState<Record<string, SegmentOverride>>({});
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null);
  const totalWidth = HOUR_WIDTH * TOTAL_HOURS;
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
    const currentWeek = getWeekStartKey(date);
    if (currentWeek === previousWeekRef.current) return;
    previousWeekRef.current = currentWeek;
    setPreviewByOccurrenceKey({});
    setCreatePreview(null);
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, (firstStart / 60) * HOUR_WIDTH - HOUR_WIDTH / 2);
      scrollRef.current.scrollTop = 0;
    }
  }, [date, firstStart]);

  function pointerToMinutes(clientX: number, track: HTMLElement): number {
    const scroll = scrollRef.current;
    if (!scroll) return 0;
    const rect = track.getBoundingClientRect();
    const offsetX = clientX - rect.left + scroll.scrollLeft;
    return clampTimelineMinutes((offsetX / HOUR_WIDTH) * 60);
  }

  function pointerToLane(clientY: number, track: HTMLElement, laneCount: number): number {
    const rect = track.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const lane = Math.floor(offsetY / LANE_HEIGHT);
    return Math.max(0, Math.min(lane, Math.max(0, laneCount - 1)));
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
      onSelect({ date: targetSegment.date, blockId: targetSegment.block.id });
      if (updates.length > 0) {
        void updateBlockTimesBatch(calData, targetSegment.date, updates);
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
    let latestPreview: SegmentOverride | null = null;

    document.body.classList.add('is-dragging-timeline-block');

    const onMove = (moveEvent: PointerEvent) => {
      const dragDelta = pointerToMinutes(moveEvent.clientX, track) - anchorMinutes;
      const nextRange = moveTimelineRange(segment.start, segment.end, dragDelta);
      if (
        !didDrag &&
        Math.abs(moveEvent.clientX - anchorClientX) < 3 &&
        nextRange.start === segment.start &&
        nextRange.end === segment.end
      ) {
        return;
      }

      didDrag = true;
      latestPreview = nextRange;
      setPreviewByOccurrenceKey({ [segment.occurrenceKey]: nextRange });
    };

    const onUp = () => {
      controller.abort();
      interactionControllerRef.current = null;
      document.body.classList.remove('is-dragging-timeline-block');
      setPreviewByOccurrenceKey({});

      onSelect({ date: segment.date, blockId: segment.block.id });
      if (!didDrag || !latestPreview) return;

      const nextTimes = absoluteMinutesToBlockTimes(latestPreview.start, latestPreview.end);
      void updateBlockTimesBatch(calData, segment.date, [
        {
          blockId: segment.block.id,
          startMin: nextTimes.startMin,
          endMin: nextTimes.endMin,
          ampm: nextTimes.ampm,
        },
      ]);
    };

    document.addEventListener('pointermove', onMove, { signal: controller.signal });
    document.addEventListener('pointerup', onUp, { signal: controller.signal, once: true });
  }

  return (
    <div className="rtimeline">
      <div className="rtimeline-scroll" ref={scrollRef}>
        <div className="rtimeline-sheet" style={{ minWidth: totalWidth + DAY_LABEL_WIDTH }}>
          <div className="rtimeline-header">
            <div className="rtimeline-dayhead" />
            <div className="rtimeline-hours" style={{ width: totalWidth }}>
              {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
                <div key={hour} className="rtimeline-hour" style={{ width: HOUR_WIDTH }}>{hourLabel(hour)}</div>
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
                  className="rtimeline-daytrack"
                  style={{ width: totalWidth, height: day.height }}
                  onPointerDown={(event) => beginCreate(event, day.date, day.laneCount)}
                >
                  {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
                    <div key={hour} className="rtimeline-gridline" style={{ left: hour * HOUR_WIDTH }} />
                  ))}

                  {!day.segments.length && totalSegments > 0 && (
                    <div className="rtimeline-dayempty">No scheduled blocks</div>
                  )}

                  {day.segments.map((segment) => {
                    const preview = previewByOccurrenceKey[segment.occurrenceKey];
                    const start = preview?.start ?? segment.start;
                    const end = preview?.end ?? segment.end;
                    const widthPx = ((end - start) / 60) * HOUR_WIDTH;
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
                          (past ? ' is-past' : '') +
                          (widthPx < 84 ? ' is-compact' : '') +
                          (widthPx < 44 ? ' is-mini' : '')
                        }
                        style={{
                          left: (start / 60) * HOUR_WIDTH,
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
                        left: (createPreview.start / 60) * HOUR_WIDTH,
                        top: createPreview.lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
                        width: ((createPreview.end - createPreview.start) / 60) * HOUR_WIDTH,
                        height: BAR_HEIGHT,
                      }}
                    />
                  )}

                  {day.date === todayKey && (
                    <div
                      className="timeline-now-marker"
                      style={{ left: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_WIDTH, height: day.height }}
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
