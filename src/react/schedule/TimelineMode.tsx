import { useEffect, useRef, useState } from 'react';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import { updateBlockTimesBatch } from '../store/actions';
import { getScheduleBlocksForDate, isBlockPast } from '../store/selectors';
import {
  absoluteMinutesToBlockTimes,
  getTimelineResizePlan,
  moveTimelineRange,
  packTimelineLanes,
  type TimelineSegment,
} from './timeline';
import { formatBlockTimeRange, getTodayKey } from '../util/format';

const HOUR_WIDTH = 96;
const TOTAL_HOURS = 24;
const LANE_HEIGHT = 48;
const BAR_HEIGHT = 38;

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
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onCreate: (draft: { startMin: number; endMin: number; ampm: 'AM' | 'PM' }) => void;
}

interface SegmentOverride {
  start: number;
  end: number;
}

export function TimelineMode({ date, selectedBlockId, onSelect, onCreate }: TimelineModeProps) {
  const calData = useCalData();
  useMinuteTick();
  const appearance = window.calderaAppearance;
  const { segments, laneCount } = packTimelineLanes(getScheduleBlocksForDate(calData, date));
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousDateRef = useRef(date);
  const interactionControllerRef = useRef<AbortController | null>(null);
  const [previewById, setPreviewById] = useState<Record<string, SegmentOverride>>({});
  const [createPreview, setCreatePreview] = useState<{ start: number; end: number; lane: number } | null>(null);
  const totalWidth = HOUR_WIDTH * TOTAL_HOURS;
  const now = new Date();
  const todayKey = getTodayKey();
  const firstStart = segments.length ? segments[0].start : 0;

  useEffect(() => () => interactionControllerRef.current?.abort(), []);

  useEffect(() => {
    if (date === previousDateRef.current) return;
    previousDateRef.current = date;
    setPreviewById({});
    setCreatePreview(null);
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, (firstStart / 60) * HOUR_WIDTH - HOUR_WIDTH / 2);
    }
  }, [date, firstStart]);

  const displaySegments = segments.map((segment) => ({
    ...segment,
    ...(previewById[segment.block.id] ?? {}),
  }));
  const segmentById = new Map<string, TimelineSegment>(segments.map((segment) => [segment.block.id, segment]));
  const bodyHeight = laneCount * LANE_HEIGHT;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  function pointerToMinutes(clientX: number): number {
    const scroll = scrollRef.current;
    if (!scroll) return 0;
    const rect = scroll.getBoundingClientRect();
    const offsetX = clientX - rect.left + scroll.scrollLeft;
    return clampTimelineMinutes((offsetX / HOUR_WIDTH) * 60);
  }

  function pointerToLane(clientY: number): number {
    const scroll = scrollRef.current;
    if (!scroll) return 0;
    const rect = scroll.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const lane = Math.floor(offsetY / LANE_HEIGHT);
    return Math.max(0, Math.min(lane, Math.max(0, laneCount - 1)));
  }

  function beginResize(
    pointerEvent: React.PointerEvent<HTMLButtonElement>,
    blockId: string,
    edge: 'start' | 'end',
  ) {
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();

    const plan = getTimelineResizePlan(segments, blockId, edge);
    if (!plan) return;

    const targetSegment = segmentById.get(plan.blockId);
    const linkedSegment = plan.linkedBlockId ? segmentById.get(plan.linkedBlockId) : null;
    if (!targetSegment) return;

    interactionControllerRef.current?.abort();
    const controller = new AbortController();
    interactionControllerRef.current = controller;
    let latestPreview: Record<string, SegmentOverride> = {};

    document.body.classList.add('is-resizing-timeline');

    const onMove = (moveEvent: PointerEvent) => {
      const boundary = Math.max(plan.minBoundary, Math.min(pointerToMinutes(moveEvent.clientX), plan.maxBoundary));
      latestPreview = plan.edge === 'start'
        ? {
            [plan.blockId]: { start: boundary, end: targetSegment.end },
            ...(linkedSegment ? { [linkedSegment.block.id]: { start: linkedSegment.start, end: boundary } } : {}),
          }
        : {
            [plan.blockId]: { start: targetSegment.start, end: boundary },
            ...(linkedSegment ? { [linkedSegment.block.id]: { start: boundary, end: linkedSegment.end } } : {}),
          };
      setPreviewById(latestPreview);
    };

    const onUp = () => {
      controller.abort();
      interactionControllerRef.current = null;
      document.body.classList.remove('is-resizing-timeline');

      const updates = Object.entries(latestPreview).map(([currentBlockId, preview]) => {
        const nextTimes = absoluteMinutesToBlockTimes(preview.start, preview.end);
        return {
          blockId: currentBlockId,
          startMin: nextTimes.startMin,
          endMin: nextTimes.endMin,
          ampm: nextTimes.ampm,
        };
      });

      setPreviewById({});
      if (updates.length > 0) {
        void updateBlockTimesBatch(calData, date, updates);
      }
    };

    document.addEventListener('pointermove', onMove, { signal: controller.signal });
    document.addEventListener('pointerup', onUp, { signal: controller.signal, once: true });
  }

  function beginCreate(pointerEvent: React.PointerEvent<HTMLDivElement>) {
    const target = pointerEvent.target as HTMLElement;
    if (target.closest('.timeline-bar')) return;

    pointerEvent.preventDefault();
    const start = pointerToMinutes(pointerEvent.clientX);
    const lane = pointerToLane(pointerEvent.clientY);

    interactionControllerRef.current?.abort();
    const controller = new AbortController();
    interactionControllerRef.current = controller;
    let latestStart = start;
    let latestEnd = start;
    let latestLane = lane;
    setCreatePreview({ start, end: start, lane });

    const onMove = (moveEvent: PointerEvent) => {
      latestEnd = pointerToMinutes(moveEvent.clientX);
      latestLane = pointerToLane(moveEvent.clientY);
      setCreatePreview({
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
        startMin: nextTimes.startMin,
        endMin: nextTimes.endMin,
        ampm: nextTimes.ampm,
      });
    };

    document.addEventListener('pointermove', onMove, { signal: controller.signal });
    document.addEventListener('pointerup', onUp, { signal: controller.signal, once: true });
  }

  function beginMove(pointerEvent: React.PointerEvent<HTMLDivElement>, blockId: string) {
    const target = pointerEvent.target as HTMLElement;
    if (target.closest('.timeline-boundary-handle')) return;

    const targetSegment = segmentById.get(blockId);
    if (!targetSegment) return;

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();

    interactionControllerRef.current?.abort();
    const controller = new AbortController();
    interactionControllerRef.current = controller;
    const anchorMinutes = pointerToMinutes(pointerEvent.clientX);
    const anchorClientX = pointerEvent.clientX;
    let didDrag = false;
    let latestPreview: SegmentOverride | null = null;

    document.body.classList.add('is-dragging-timeline-block');

    const onMove = (moveEvent: PointerEvent) => {
      const dragDelta = pointerToMinutes(moveEvent.clientX) - anchorMinutes;
      const nextRange = moveTimelineRange(targetSegment.start, targetSegment.end, dragDelta);
      if (
        !didDrag &&
        Math.abs(moveEvent.clientX - anchorClientX) < 3 &&
        nextRange.start === targetSegment.start &&
        nextRange.end === targetSegment.end
      ) {
        return;
      }

      didDrag = true;
      latestPreview = nextRange;
      setPreviewById({ [blockId]: nextRange });
    };

    const onUp = () => {
      controller.abort();
      interactionControllerRef.current = null;
      document.body.classList.remove('is-dragging-timeline-block');
      setPreviewById({});

      if (!didDrag || !latestPreview) {
        onSelect(blockId);
        return;
      }

      const nextTimes = absoluteMinutesToBlockTimes(latestPreview.start, latestPreview.end);
      onSelect(blockId);
      void updateBlockTimesBatch(calData, date, [
        {
          blockId,
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
        <div style={{ width: totalWidth }}>
          <div className="rtimeline-header">
            {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
              <div key={hour} className="rtimeline-hour" style={{ width: HOUR_WIDTH }}>{hourLabel(hour)}</div>
            ))}
          </div>

          <div className="rtimeline-bars" style={{ height: bodyHeight }} onPointerDown={beginCreate}>
            {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
              <div key={hour} className="rtimeline-gridline" style={{ left: hour * HOUR_WIDTH }} />
            ))}

            {displaySegments.map(({ block, start, end, lane }) => {
              const widthPx = ((end - start) / 60) * HOUR_WIDTH;
              const past = isBlockPast(block, date, now, todayKey) && !block.completed;
              const label = block.recurring ? `${block.label} (Recurring)` : block.label;
              return (
                <div
                  key={block.id}
                  className={
                    'timeline-bar' +
                    (block.id === selectedBlockId ? ' is-selected' : '') +
                    (block.completed ? ' is-complete' : '') +
                    (block.recurring ? ' is-recurring' : '') +
                    (past ? ' is-past' : '') +
                    (widthPx < 84 ? ' is-compact' : '') +
                    (widthPx < 44 ? ' is-mini' : '')
                  }
                  style={{
                    left: (start / 60) * HOUR_WIDTH,
                    top: lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
                    width: widthPx,
                    height: BAR_HEIGHT,
                    background: appearance?.gradientCss(block) ?? block.color,
                  }}
                  title={`${label} - ${formatBlockTimeRange(block)}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => beginMove(event, block.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(block.id);
                    }
                  }}
                >
                  <span className="timeline-bar-label">{label}</span>
                  <span className="timeline-bar-time">{formatBlockTimeRange(block)}</span>
                  <button
                    type="button"
                    className="timeline-boundary-handle is-leading"
                    style={{ left: 0 }}
                    title="Drag to adjust the block start time"
                    onPointerDown={(event) => beginResize(event, block.id, 'start')}
                  />
                  <button
                    type="button"
                    className="timeline-boundary-handle is-trailing"
                    style={{ left: widthPx }}
                    title="Drag to adjust the block end time"
                    onPointerDown={(event) => beginResize(event, block.id, 'end')}
                  />
                </div>
              );
            })}

            {createPreview && createPreview.end - createPreview.start >= 15 && (
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

            {date === todayKey && (
              <div
                className="timeline-now-marker"
                style={{ left: (currentMinutes / 60) * HOUR_WIDTH, height: bodyHeight }}
              />
            )}
          </div>

          {!segments.length && !createPreview && (
            <div className="rtimeline-empty">No scheduled blocks yet. Drag across the timeline to add one.</div>
          )}
        </div>
      </div>
    </div>
  );
}
