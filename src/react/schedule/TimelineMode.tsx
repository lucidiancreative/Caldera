// Day-scale timeline. Reuses the vanilla .timeline-bar styling but stacks
// overlapping blocks into lanes (packTimelineLanes) and opens scrolled to the
// earliest block so it never lands on empty pre-dawn hours.
import { useEffect, useRef } from 'react';
import { useCalData } from '../store/calStore';
import { getScheduleBlocksForDate, isBlockPast } from '../store/selectors';
import { packTimelineLanes } from './timeline';
import { formatBlockTimeRange, getTodayKey } from '../util/format';

const HOUR_WIDTH = 96;
const TOTAL_HOURS = 24;
const LANE_HEIGHT = 48;
const BAR_HEIGHT = 38;

function hourLabel(hour: number): string {
  const n = hour % 24;
  return `${n % 12 || 12} ${n >= 12 ? 'PM' : 'AM'}`;
}

interface TimelineModeProps {
  date: string;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}

export function TimelineMode({ date, selectedBlockId, onSelect }: TimelineModeProps) {
  const calData = useCalData();
  const { segments, laneCount } = packTimelineLanes(getScheduleBlocksForDate(calData, date));
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalWidth = HOUR_WIDTH * TOTAL_HOURS;
  const now = new Date();
  const todayKey = getTodayKey();
  const firstStart = segments.length ? segments[0].start : 0;

  // Land on the earliest block (with a half-hour lead-in) whenever the day changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, (firstStart / 60) * HOUR_WIDTH - HOUR_WIDTH / 2);
    }
  }, [date, firstStart]);

  if (!segments.length) {
    return <div className="rtimeline-empty">No scheduled blocks for this day yet.</div>;
  }

  const bodyHeight = laneCount * LANE_HEIGHT;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="rtimeline">
      <div className="rtimeline-scroll" ref={scrollRef}>
        <div style={{ width: totalWidth }}>
          <div className="rtimeline-header">
            {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
              <div key={hour} className="rtimeline-hour" style={{ width: HOUR_WIDTH }}>{hourLabel(hour)}</div>
            ))}
          </div>

          <div className="rtimeline-bars" style={{ height: bodyHeight }}>
            {Array.from({ length: TOTAL_HOURS }, (_, hour) => (
              <div key={hour} className="rtimeline-gridline" style={{ left: hour * HOUR_WIDTH }} />
            ))}

            {segments.map(({ block, start, end, lane }) => {
              const widthPx = ((end - start) / 60) * HOUR_WIDTH;
              const past = isBlockPast(block, date, now, todayKey) && !block.completed;
              const label = block.recurring ? `${block.label} (Recurring)` : block.label;
              return (
                <button
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
                    background: block.color,
                  }}
                  title={`${label} - ${formatBlockTimeRange(block)}`}
                  onClick={() => onSelect(block.id)}
                >
                  <span className="timeline-bar-label">{label}</span>
                  <span className="timeline-bar-time">{formatBlockTimeRange(block)}</span>
                </button>
              );
            })}

            {date === todayKey && (
              <div
                className="timeline-now-marker"
                style={{ left: (currentMinutes / 60) * HOUR_WIDTH, height: bodyHeight }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
