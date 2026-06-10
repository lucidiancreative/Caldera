// Pure clock geometry, ported verbatim from the vanilla renderer so the React clock
// draws identical arcs. The clock face is a 12-hour dial: minutes are 0–719 and
// 0 minutes points straight up (−90°).
export const CLOCK = { vb: 400, cx: 200, cy: 200, R: 170, r1: Math.round(170 * 0.62), r2: Math.round(170 * 0.85) };

/** Wedge path between inner radius r1 and outer r2, from startMin to endMin, with optional rounded corners. */
export function arcPath(cx: number, cy: number, r1: number, r2: number, startMin: number, endMin: number, rnd = 0): string {
  const spanMin = (endMin - startMin + 720) % 720;
  if (spanMin === 0) return '';
  const startAng = (startMin / 720) * 2 * Math.PI - Math.PI / 2;
  const endAng = startAng + (spanMin / 720) * 2 * Math.PI;
  const large = spanMin > 360 ? 1 : 0;
  const c1 = Math.cos(startAng), s1 = Math.sin(startAng);
  const c2 = Math.cos(endAng), s2 = Math.sin(endAng);

  const ox1 = cx + r2 * c1, oy1 = cy + r2 * s1;
  const ox2 = cx + r2 * c2, oy2 = cy + r2 * s2;
  const ix1 = cx + r1 * c2, iy1 = cy + r1 * s2;
  const ix2 = cx + r1 * c1, iy2 = cy + r1 * s1;

  if (rnd <= 0) {
    return `M ${ox1} ${oy1} A ${r2} ${r2} 0 ${large} 1 ${ox2} ${oy2} ` +
      `L ${ix1} ${iy1} A ${r1} ${r1} 0 ${large} 0 ${ix2} ${iy2} Z`;
  }

  const r = Math.min(rnd, (r2 - r1) * 0.45);
  const p = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;

  const Aa: [number, number] = [ox1 - r * c1, oy1 - r * s1];
  const Ad: [number, number] = [ox1 - r * s1, oy1 + r * c1];
  const Ba: [number, number] = [ox2 + r * s2, oy2 - r * c2];
  const Bd: [number, number] = [ox2 - r * c2, oy2 - r * s2];
  const Ca: [number, number] = [ix1 + r * c2, iy1 + r * s2];
  const Cd: [number, number] = [ix1 + r * s2, iy1 - r * c2];
  const Da: [number, number] = [ix2 - r * s1, iy2 + r * c1];
  const Dd: [number, number] = [ix2 + r * c1, iy2 + r * s1];

  return (
    `M ${p(...Ad)} ` +
    `A ${r2} ${r2} 0 ${large} 1 ${p(...Ba)} ` +
    `Q ${p(ox2, oy2)} ${p(...Bd)} ` +
    `L ${p(...Ca)} ` +
    `Q ${p(ix1, iy1)} ${p(...Cd)} ` +
    `A ${r1} ${r1} 0 ${large} 0 ${p(...Da)} ` +
    `Q ${p(ix2, iy2)} ${p(...Dd)} Z`
  );
}

/** Mid-radius arc used as the baseline for a curved arc label. */
export function labelArcPath(cx: number, cy: number, rMid: number, startMin: number, spanMin: number): string {
  const startAng = (startMin / 720) * 2 * Math.PI - Math.PI / 2;
  const endAng = startAng + (spanMin / 720) * 2 * Math.PI;
  const large = spanMin > 360 ? 1 : 0;
  const lx1 = cx + rMid * Math.cos(startAng), ly1 = cy + rMid * Math.sin(startAng);
  const lx2 = cx + rMid * Math.cos(endAng), ly2 = cy + rMid * Math.sin(endAng);
  return `M ${lx1} ${ly1} A ${rMid} ${rMid} 0 ${large} 1 ${lx2} ${ly2}`;
}

/** Clock minute (snapped to 15) for a point, measured from the 12-o'clock top. */
export function minutesFromPoint(cx: number, cy: number, px: number, py: number): number {
  const ang = Math.atan2(py - cy, px - cx) + Math.PI / 2;
  const raw = ((ang / (2 * Math.PI)) * 720 + 720) % 720;
  return (Math.round(raw / 15) * 15) % 720;
}

/** Truncate a label to roughly fit the arc length it sits on. */
export function fitArcLabel(label: string, spanMin: number, rMid: number): string {
  const arcLen = (spanMin / 720) * 2 * Math.PI * rMid;
  const maxChars = Math.max(1, Math.floor(arcLen / 7));
  return label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
}
