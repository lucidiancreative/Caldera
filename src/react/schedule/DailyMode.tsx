// Daily clock mode — a faithful React port of the vanilla analog clock. 12-hour dial
// with an AM/PM toggle; in PM the AM blocks show as a dimmed overlay. Arcs paint from
// the shared appearance bridge so colors match the active skin exactly. Drag-to-create
// is deferred to the editing step; selection works by clicking an arc or legend chip.
import { Fragment, useEffect, useRef, useState } from 'react';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import { getDayData, getScheduleBlocksForDate, isBlockPast, type ScheduleBlock } from '../store/selectors';
import { arcPath, labelArcPath, fitArcLabel, minutesFromPoint, CLOCK } from './clock';
import { formatBlockTimeRange, getTodayKey } from '../util/format';

const gradId = (slot: number) => `react-block-grad-slot-${slot}`;
type AmPm = 'AM' | 'PM';

interface DailyModeProps {
  date: string;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onCreate: (draft: { startMin: number; endMin: number; ampm: AmPm }) => void;
}

export function DailyMode({ date, selectedBlockId, onSelect, onCreate }: DailyModeProps) {
  const calData = useCalData();
  const [ampm, setAmpm] = useState<AmPm>(new Date().getHours() >= 12 ? 'PM' : 'AM');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ start: number; current: number } | null>(null);
  const dragControllerRef = useRef<AbortController | null>(null);
  const [dragView, setDragView] = useState<{ start: number; current: number } | null>(null);
  useMinuteTick();

  useEffect(() => () => dragControllerRef.current?.abort(), []);

  const appearance = window.calderaAppearance;
  const palette = appearance?.palette() ?? [];
  const rnd = appearance?.cornerRadius() ?? 6;
  const { cx, cy, R, r1, r2 } = CLOCK;
  const rMid = (r1 + r2) / 2;

  const allBlocks = getScheduleBlocksForDate(calData, date);
  const visibleBlocks = allBlocks.filter((block) => block.ampm === ampm);
  const overlayBlocks = ampm === 'PM' ? allBlocks.filter((block) => block.ampm === 'AM') : [];
  const now = new Date();
  const todayKey = getTodayKey();

  const fillOf = (block: ScheduleBlock) =>
    palette.length ? `url(#${gradId(appearance!.slotForBlock(block))})` : block.color;

  const handMin = (now.getHours() % 12) * 60 + now.getMinutes();
  const handAng = (handMin / 720) * 2 * Math.PI - Math.PI / 2;

  function pointToMinutes(clientX: number, clientY: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left) * (CLOCK.vb / rect.width);
    const y = (clientY - rect.top) * (CLOCK.vb / rect.height);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < r1 - 10 || dist > r2 + 10) return null; // outside the draggable ring
    return minutesFromPoint(cx, cy, x, y);
  }

  // Drag across the ring to sketch a new block, then open the editor on release.
  // Uses document listeners scoped to one drag (like the vanilla clock) so the same
  // handler instances are added and removed, avoiding stale-listener bugs.
  function onRingMouseDown(event: React.MouseEvent) {
    const start = pointToMinutes(event.clientX, event.clientY);
    if (start == null) return;
    dragRef.current = { start, current: start };
    setDragView(dragRef.current);
    dragControllerRef.current?.abort();
    const controller = new AbortController();
    dragControllerRef.current = controller;

    const onMove = (move: MouseEvent) => {
      const current = pointToMinutes(move.clientX, move.clientY);
      if (current == null || !dragRef.current) return;
      dragRef.current = { start: dragRef.current.start, current };
      setDragView(dragRef.current);
    };
    const onUp = () => {
      controller.abort();
      dragControllerRef.current = null;
      const drag = dragRef.current;
      dragRef.current = null;
      setDragView(null);
      if (!drag) return;
      const span = (drag.current - drag.start + 720) % 720;
      if (span >= 15) onCreate({ startMin: drag.start, endMin: drag.current, ampm });
    };
    document.addEventListener('mousemove', onMove, { signal: controller.signal });
    document.addEventListener('mouseup', onUp, { signal: controller.signal, once: true });
  }

  const dragSpan = dragView ? (dragView.current - dragView.start + 720) % 720 : 0;
  const previewSlot = palette.length
    ? (getDayData(calData, date)?.timeBlocks?.length ?? 0) % palette.length
    : 0;
  const visibleBoundaryRounding = getBoundaryRoundingMap(visibleBlocks);
  const overlayBoundaryRounding = getBoundaryRoundingMap(overlayBlocks);

  function renderArc(block: ScheduleBlock, overlay: boolean) {
    const spanMin = (block.endMin - block.startMin + 720) % 720;
    const past = isBlockPast(block, date, now, todayKey);
    const arcClass =
      'clock-block-arc' +
      (block.recurring ? ' recurring-arc' : '') +
      (!overlay && block.id === selectedBlockId ? ' is-selected' : '');
    const dimClass = overlay ? 'am-overlay-arc' : past ? 'crossover-arc' : '';
    const labelId = `react-arc-label-${overlay ? 'ov-' : ''}${block.id}`;
    const rounding = (overlay ? overlayBoundaryRounding : visibleBoundaryRounding).get(block.id) ?? { roundStart: true, roundEnd: true };
    return (
      <g
        key={(overlay ? 'ov-' : '') + block.id}
        className={dimClass}
        onClick={overlay ? undefined : () => onSelect(block.id)}
        style={overlay ? undefined : { cursor: 'pointer' }}
      >
        <path
          className={arcClass}
          d={arcPath(cx, cy, r1, r2, block.startMin, block.endMin, {
            radius: rnd,
            roundStart: rounding.roundStart,
            roundEnd: rounding.roundEnd,
          })}
          fill={fillOf(block)}
        />
        {spanMin >= 30 && block.label && (
          <>
            <defs>
              <path id={labelId} d={labelArcPath(cx, cy, rMid, block.startMin, spanMin)} />
            </defs>
            <text className="clock-block-label">
              <textPath href={`#${labelId}`} startOffset="50%" textAnchor="middle">
                {fitArcLabel(block.label, spanMin, rMid)}
              </textPath>
            </text>
          </>
        )}
      </g>
    );
  }

  return (
    <div className="rdaily">
      <div className="rdaily-ampm">
        <button className={'ampm-btn' + (ampm === 'AM' ? ' active' : '')} onClick={() => setAmpm('AM')}>AM</button>
        <button className={'ampm-btn' + (ampm === 'PM' ? ' active' : '')} onClick={() => setAmpm('PM')}>PM</button>
      </div>

      <div className="rdaily-clock">
        <svg ref={svgRef} viewBox={`0 0 ${CLOCK.vb} ${CLOCK.vb}`} onMouseDown={onRingMouseDown} style={{ cursor: 'crosshair' }}>
          <defs>
            {palette.map((slot, index) => (
              <radialGradient
                key={index}
                id={gradId(index)}
                cx={String(cx)} cy={String(cy)} r={String(r2)}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor={slot.highlight} />
                <stop offset="100%" stopColor={slot.base} />
              </radialGradient>
            ))}
          </defs>

          <circle className="clock-face" cx={cx} cy={cy} r={R} />

          {Array.from({ length: 12 }, (_, h) => {
            const ang = (h / 12) * 2 * Math.PI - Math.PI / 2;
            const cos = Math.cos(ang), sin = Math.sin(ang);
            const isMajor = h % 3 === 0;
            const tickIn = R * (isMajor ? 0.88 : 0.91);
            const tickOut = R * 0.975;
            const numR = R * 0.73;
            return (
              <Fragment key={h}>
                <line
                  className={isMajor ? 'clock-tick clock-tick-major' : 'clock-tick'}
                  x1={cx + tickIn * cos} y1={cy + tickIn * sin}
                  x2={cx + tickOut * cos} y2={cy + tickOut * sin}
                />
                <text
                  className="clock-num"
                  x={cx + numR * cos} y={cy + numR * sin}
                  textAnchor="middle" dominantBaseline="central"
                >
                  {h === 0 ? '12' : String(h)}
                </text>
              </Fragment>
            );
          })}

          {overlayBlocks.map((block) => renderArc(block, true))}
          {visibleBlocks.map((block) => renderArc(block, false))}

          {dragView && dragSpan >= 15 && (
            <path
              className="clock-preview"
              d={arcPath(cx, cy, r1, r2, dragView.start, dragView.current, rnd)}
              fill={palette.length ? `url(#${gradId(previewSlot)})` : '#888'}
            />
          )}

          <line
            className="clock-hand"
            x1={cx + 10 * Math.cos(handAng)} y1={cy + 10 * Math.sin(handAng)}
            x2={cx + r1 * Math.cos(handAng)} y2={cy + r1 * Math.sin(handAng)}
          />
          <circle className="clock-hand-dot" cx={cx} cy={cy} r={2} />
        </svg>
      </div>

      <div className="rdaily-legend">
        {visibleBlocks.length === 0 ? (
          <span className="rdaily-hint">No {ampm} blocks. Drag on the ring to add one.</span>
        ) : (
          visibleBlocks.map((block) => (
            <span
              key={block.id}
              className={'block-chip' + (block.id === selectedBlockId ? ' is-selected' : '')}
              style={{ background: appearance?.gradientCss(block) ?? block.color }}
              title={formatBlockTimeRange(block)}
              onClick={() => onSelect(block.id)}
            >
              {block.recurring ? `${block.label} (Recurring)` : block.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function getBoundaryRoundingMap(blocks: ScheduleBlock[]): Map<string, { roundStart: boolean; roundEnd: boolean }> {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.label.localeCompare(b.label));
  const map = new Map<string, { roundStart: boolean; roundEnd: boolean }>();

  sorted.forEach((block) => {
    map.set(block.id, { roundStart: true, roundEnd: true });
  });

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (current.endMin !== next.startMin) continue;
    map.set(current.id, { ...(map.get(current.id) ?? { roundStart: true, roundEnd: true }), roundEnd: false });
    map.set(next.id, { ...(map.get(next.id) ?? { roundStart: true, roundEnd: true }), roundStart: false });
  }

  return map;
}
