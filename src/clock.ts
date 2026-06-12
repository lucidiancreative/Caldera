function buildClockSVG(key: string, blocks: BlockOrPartial[]): SVGSVGElement {
  const VB = 400, cx = 200, cy = 200, R = 170;
  const r1 = Math.round(R * 0.62);
  const r2 = Math.round(R * 0.85);

  const svg = svgEl('svg', { viewBox: `0 0 ${VB} ${VB}` }) as SVGSVGElement;

  const defs = svgEl('defs', {});
  getBlockColors().forEach((color, slot) => {
    const highlight = getBlockHighlightBySlot(slot);
    const grad = svgEl('radialGradient', {
      id: getBlockGradientId(slot),
      cx: String(cx), cy: String(cy), r: String(r2),
      gradientUnits: 'userSpaceOnUse',
    });
    const stop1 = svgEl('stop', { offset: '0%', 'stop-color': highlight });
    const stop2 = svgEl('stop', { offset: '100%', 'stop-color': color });
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
  });
  svg.appendChild(defs);

  svg.appendChild(svgEl('circle', { class: 'clock-face', cx, cy, r: R }));

  for (let h = 0; h < 12; h++) {
    const ang = (h / 12) * 2 * Math.PI - Math.PI / 2;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const isMajor = h % 3 === 0;
    const tickIn = R * (isMajor ? 0.88 : 0.91);
    const tickOut = R * 0.975;

    svg.appendChild(svgEl('line', {
      class: isMajor ? 'clock-tick clock-tick-major' : 'clock-tick',
      x1: cx + tickIn * cos, y1: cy + tickIn * sin,
      x2: cx + tickOut * cos, y2: cy + tickOut * sin,
    }));

    const label = h === 0 ? '12' : String(h);
    const numR = R * 0.73;
    const txt = svgEl('text', { class: 'clock-num', x: cx + numR * cos, y: cy + numR * sin });
    txt.textContent = label;
    svg.appendChild(txt);
  }

  blocks.forEach(block => {
    const blockAny = block as BlockOrPartial & {
      _amOverlay?: boolean;
      _recurring?: boolean;
      label?: string;
      id?: string;
      recurrence?: string;
      color?: string;
    };
    const isRescheduling = rescheduleBlock?.id === blockAny.id;
    const isPast = isPastBlock(block as TimeBlock, key);
    const paletteSlot = getBlockPaletteSlot(blockAny);

    const dimClass = blockAny._amOverlay ? 'am-overlay-arc'
      : isPast ? 'crossover-arc'
      : '';
    const g = svgEl('g', {
      class: [isRescheduling ? 'rescheduling-arc' : '', dimClass].filter(Boolean).join(' '),
    });

    if (!blockAny._amOverlay) {
      g.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        if (blockAny.id) selectScheduleBlock(key, blockAny.id);
      });
      g.addEventListener('mouseenter', () => { hoveredClockBlock = { block: block as TimeBlock | RecurringBlock, key }; });
      g.addEventListener('mouseleave', () => { hoveredClockBlock = null; });
    }

    const path = svgEl('path', {
      class: 'clock-block-arc' +
        (blockAny._recurring ? ' recurring-arc' : '') +
        (blockAny.id && isSelectedScheduleBlock(key, blockAny.id) ? ' is-selected' : ''),
      d: arcPath(cx, cy, r1, r2, block.startMin, block.endMin, getClockBlockCornerRadius()),
      fill: `url(#${getBlockGradientId(paletteSlot)})`,
    });
    g.appendChild(path);

    const spanMin = (block.endMin - block.startMin + 720) % 720;
    if (spanMin >= 30 && blockAny.label) {
      const rMid = (r1 + r2) / 2;
      const arcLen = (spanMin / 720) * 2 * Math.PI * rMid;
      const maxChars = Math.max(1, Math.floor(arcLen / 7));
      const display = blockAny.label.length > maxChars
        ? blockAny.label.slice(0, maxChars - 1) + '\u2026'
        : blockAny.label;

      const startAng = (block.startMin / 720) * 2 * Math.PI - Math.PI / 2;
      const endAng = startAng + (spanMin / 720) * 2 * Math.PI;
      const large = spanMin > 360 ? 1 : 0;
      const lx1 = cx + rMid * Math.cos(startAng), ly1 = cy + rMid * Math.sin(startAng);
      const lx2 = cx + rMid * Math.cos(endAng), ly2 = cy + rMid * Math.sin(endAng);
      const pathId = `arc-label-path-${blockAny.id}`;

      defs.appendChild(svgEl('path', { id: pathId, d: `M ${lx1} ${ly1} A ${rMid} ${rMid} 0 ${large} 1 ${lx2} ${ly2}` }));

      const tp = svgEl('textPath', { href: `#${pathId}`, startOffset: '50%', 'text-anchor': 'middle' });
      tp.textContent = display;
      const textEl = svgEl('text', { class: 'clock-block-label' });
      textEl.appendChild(tp);
      g.appendChild(textEl);
    }

    svg.appendChild(g);
  });

  const preview = svgEl('path', {
    id: 'clock-preview-arc',
    class: 'clock-preview',
    fill: `url(#${getBlockGradientId(0)})`,
    d: '',
  });
  svg.appendChild(preview);

  const hand = svgEl('line', { id: 'clock-hand', class: 'clock-hand', x1: cx, y1: cy, x2: cx, y2: cy });
  svg.appendChild(hand);
  svg.appendChild(svgEl('circle', { class: 'clock-hand-dot', cx, cy, r: 2 }));

  bindClockInteraction(svg, cx, cy, r1, r2, key);
  return svg;
}

function arcPath(cx: number, cy: number, r1: number, r2: number, startMin: number, endMin: number, rnd = 0): string {
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
    `Q ${p(ix2, iy2)} ${p(...Dd)} ` +
    `L ${p(...Aa)} ` +
    `Q ${p(ox1, oy1)} ${p(...Ad)} Z`
  );
}

function svgPoint(svg: SVGSVGElement, e: MouseEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (400 / rect.width),
    y: (e.clientY - rect.top) * (400 / rect.height),
  };
}

function minutesFromPoint(cx: number, cy: number, px: number, py: number): number {
  const ang = Math.atan2(py - cy, px - cx) + Math.PI / 2;
  const raw = ((ang / (2 * Math.PI)) * 720 + 720) % 720;
  return Math.round(raw / 15) * 15 % 720;
}

function bindClockInteraction(svg: SVGSVGElement, cx: number, cy: number, r1: number, r2: number, key: string): void {
  svg.addEventListener('mousedown', (e: MouseEvent) => {
    if (timeBlockPopupState) return;
    const pt = svgPoint(svg, e);
    const dist = Math.hypot(pt.x - cx, pt.y - cy);
    if (dist < r1 - 10 || dist > r2 + 10) return;

    const startMin = minutesFromPoint(cx, cy, pt.x, pt.y);
    const previewPath = document.getElementById('clock-preview-arc') as SVGPathElement | null;
    const previewSlot = (getDayData(key)?.timeBlocks?.length || 0) % getBlockPaletteSize();
    previewPath?.setAttribute('fill', `url(#${getBlockGradientId(previewSlot)})`);

    let lastMin = startMin;

    function onClockDragMove(ev: MouseEvent): void {
      const pt2 = svgPoint(svg, ev);
      lastMin = minutesFromPoint(cx, cy, pt2.x, pt2.y);
      const span = (lastMin - startMin + 720) % 720;
      previewPath?.setAttribute('d', span >= 15 ? arcPath(cx, cy, r1, r2, startMin, lastMin, getClockBlockCornerRadius()) : '');
    }

    function onClockDragEnd(): void {
      document.removeEventListener('mousemove', onClockDragMove);
      document.removeEventListener('mouseup', onClockDragEnd);
      previewPath?.setAttribute('d', '');
      clockDragState = null;

      const endMin = lastMin;
      const span = (endMin - startMin + 720) % 720;
      if (span < 15) return;
      showTimeBlockPopup('new', { startMin, endMin }, key, svg, cx, cy, 170);
    }

    clockDragState = { startMin, svg };
    document.addEventListener('mousemove', onClockDragMove);
    document.addEventListener('mouseup', onClockDragEnd);
    e.preventDefault();
  });
}

function showTimeBlockPopup(mode: 'new' | 'edit', blockOrData: BlockOrPartial, key: string, svg: SVGSVGElement, cx: number, cy: number, R: number): void {
  const popup = qId('block-label-popup');
  const input = qId<HTMLInputElement>('block-label-input');
  const confirmBtn = qId('block-label-confirm');
  const delBtn = qId('block-label-del');
  const ampmSel = qId<HTMLSelectElement>('block-ampm-select');
  const recurSel = qId<HTMLSelectElement>('block-recurrence-select');
  const scopeRow = qId('block-scope-row');
  const { startMin, endMin, id, label } = blockOrData as BlockOrPartial & { id?: string; label?: string };
  const blockAny = blockOrData as BlockOrPartial & { _recurring?: boolean; recurrence?: string; ampm?: AmPm };
  const isRecurring = !!blockAny._recurring;

  timeBlockPopupState = { mode, key, startMin, endMin, id };
  input.value = label || '';
  ampmSel.value = blockAny.ampm || clockAmPm;
  recurSel.value = isRecurring ? (blockAny.recurrence || 'daily') : 'none';

  if (mode === 'edit' && isRecurring) {
    scopeRow.classList.remove('hidden');
    (scopeRow.querySelector('input[value="all"]') as HTMLInputElement).checked = true;
  } else {
    scopeRow.classList.add('hidden');
  }

  const spanMin = (endMin - startMin + 720) % 720;
  const midMin = (startMin + spanMin / 2) % 720;
  const ang = (midMin / 720) * 2 * Math.PI - Math.PI / 2;
  const r = (R * 0.62 + R * 0.85) / 2;
  const rect = svg.getBoundingClientRect();
  const sx = rect.left + (cx + r * Math.cos(ang)) * (rect.width / 400);
  const sy = rect.top + (cy + r * Math.sin(ang)) * (rect.height / 400);

  popup.style.left = Math.min(sx - 10, window.innerWidth - 260) + 'px';
  popup.style.top = Math.min(sy - 20, window.innerHeight - 220) + 'px';
  delBtn.title = mode === 'new' ? 'Cancel' : 'Delete block';

  popup.classList.remove('hidden');
  input.focus();

  function getSelectedBlockScope(): string {
    return (scopeRow.querySelector('input[name="block-scope"]:checked') as HTMLInputElement | null)?.value || 'all';
  }

  function commitBlockEdit(): void {
    const lbl = input.value.trim();
    const ampm = ampmSel.value as AmPm;
    const recurrence = recurSel.value;
    const scope = getSelectedBlockScope();
    closeTimeBlockPopup();
    if (!lbl) {
      if (mode === 'edit' && id) deleteTimeBlock(key, id, isRecurring ? scope : undefined);
      return;
    }
    if (mode === 'new') {
      saveTimeBlock(key, { startMin, endMin, label: lbl }, recurrence, ampm);
    } else if (mode === 'edit' && id) {
      updateTimeBlock(key, id, lbl, recurrence, scope, ampm);
    }
  }

  function onBlockLabelKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') { ev.preventDefault(); commitBlockEdit(); }
    if (ev.key === 'Escape') { closeTimeBlockPopup(); }
  }

  function onBlockLabelBlur(): void {
    setTimeout(() => {
      if (timeBlockPopupState && !popup.contains(document.activeElement)) commitBlockEdit();
    }, 150);
  }

  function onBlockDeleteClick(): void {
    const scope = getSelectedBlockScope();
    closeTimeBlockPopup();
    if (mode === 'edit' && id) deleteTimeBlock(key, id, isRecurring ? scope : undefined);
  }

  input.addEventListener('keydown', onBlockLabelKeyDown);
  input.addEventListener('blur', onBlockLabelBlur);
  confirmBtn.addEventListener('click', commitBlockEdit);
  delBtn.addEventListener('click', onBlockDeleteClick);

  function onBlockRecurrenceChange(): void {
    if (mode !== 'edit' || !isRecurring) scopeRow.classList.add('hidden');
  }
  recurSel.addEventListener('change', onBlockRecurrenceChange);

  timeBlockPopupState._cleanup = () => {
    input.removeEventListener('keydown', onBlockLabelKeyDown);
    input.removeEventListener('blur', onBlockLabelBlur);
    confirmBtn.removeEventListener('click', commitBlockEdit);
    delBtn.removeEventListener('click', onBlockDeleteClick);
    recurSel.removeEventListener('change', onBlockRecurrenceChange);
  };
}

function closeTimeBlockPopup(): void {
  const popup = qId('block-label-popup');
  popup.classList.add('hidden');
  if (timeBlockPopupState?._cleanup) timeBlockPopupState._cleanup();
  timeBlockPopupState = null;
}

async function saveTimeBlock(key: string, { startMin, endMin, label }: { startMin: number; endMin: number; label: string }, recurrence = 'none', ampm: AmPm = clockAmPm): Promise<void> {
  pushCalendarSnapshot();
  if (recurrence === 'none') {
    const day = getOrInitDayData(key);
    const paletteSlot = day.timeBlocks.length % getBlockPaletteSize();
    day.timeBlocks.push({
      id: generateCalendarEntryId(),
      startMin,
      endMin,
      label,
      ...getBlockStorageAppearance({ paletteSlot }),
      ampm,
      completed: false,
      subtasks: [],
    });
  } else {
    if (!calData._recurring) calData._recurring = [];
    const paletteSlot = calData._recurring.length % getBlockPaletteSize();
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    calData._recurring.push({
      id: generateCalendarEntryId(), startMin, endMin, label, ...getBlockStorageAppearance({ paletteSlot }), ampm,
      recurrence: recurrence as RecurringBlock['recurrence'],
      dayOfWeek: date.getDay(),
      dayOfMonth: d,
      completedDates: [],
      excludedDates: [],
      subtasks: [],
    });
  }
  // Remember the saved block's meridian as the clock's current AM/PM. (This used to
  // call schedule.ts's setScheduleAmPm, which also synced the vanilla .ampm-btn row;
  // that row was retired with the React schedule, so only the state memory remains.)
  if (ampm !== clockAmPm) clockAmPm = ampm;
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

async function updateTimeBlock(key: string, blockId: string, label: string, recurrence: string, scope: string, ampm: AmPm): Promise<void> {
  pushCalendarSnapshot();
  const recurring = calData._recurring || [];
  const rIdx = recurring.findIndex(b => b.id === blockId);
  const isRecurring = rIdx !== -1;

  if (isRecurring) {
    const block = recurring[rIdx];
    const appearance = getBlockStorageAppearance(block);
    if (scope === 'today') {
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
      const day = getOrInitDayData(key);
      day.timeBlocks.push({
        id: generateCalendarEntryId(), startMin: block.startMin, endMin: block.endMin,
        label, ...appearance, ampm, completed: false, subtasks: [...(block.subtasks || [])],
      });
    } else {
      block.label = label;
      block.ampm = ampm;
      if (recurrence === 'none') {
        recurring.splice(rIdx, 1);
        const day = getOrInitDayData(key);
        const completed = block.completedDates?.includes(key) || false;
        day.timeBlocks.push({
          id: block.id, startMin: block.startMin, endMin: block.endMin,
          label, ...appearance, ampm, completed, subtasks: [...(block.subtasks || [])],
        });
      } else {
        block.recurrence = recurrence as RecurringBlock['recurrence'];
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        block.dayOfWeek = date.getDay();
        block.dayOfMonth = d;
      }
    }
  } else {
    const block = getDayData(key)?.timeBlocks?.find(b => b.id === blockId);
    if (!block) return;
    const appearance = getBlockStorageAppearance(block);
    block.label = label;
    block.ampm = ampm;
    if (recurrence !== 'none') {
      const day = getDayData(key)!;
      day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
      if (!calData._recurring) calData._recurring = [];
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      calData._recurring.push({
        id: block.id, startMin: block.startMin, endMin: block.endMin,
        label, ...appearance, ampm,
        recurrence: recurrence as RecurringBlock['recurrence'],
        dayOfWeek: date.getDay(),
        dayOfMonth: d,
        completedDates: block.completed ? [key] : [],
        excludedDates: [],
        subtasks: [...(block.subtasks || [])],
      });
    }
  }
  // See saveTimeBlock: remember the edited block's meridian without touching the
  // retired vanilla .ampm-btn row.
  if (ampm !== clockAmPm) clockAmPm = ampm;
  await saveCalendarDataAndRefresh(key, { renderCurrentSchedule: true });
}

async function deleteTimeBlock(key: string, blockId: string, scope?: string): Promise<void> {
  pushCalendarSnapshot();
  const recurring = calData._recurring || [];
  const rIdx = recurring.findIndex(b => b.id === blockId);
  if (rIdx !== -1) {
    if (scope === 'today') {
      const block = recurring[rIdx];
      if (!block.excludedDates) block.excludedDates = [];
      block.excludedDates.push(key);
    } else {
      recurring.splice(rIdx, 1);
    }
    await saveCalendarDataAndRefresh(key, { renderCurrentSchedule: true });
    return;
  }
  const day = getDayData(key);
  if (!day?.timeBlocks) return;
  day.timeBlocks = day.timeBlocks.filter(b => b.id !== blockId);
  await saveCalendarDataAndRefresh(key, { renderSchedule: true });
}

function renderBlockLegend(key: string, blocks: (TimeBlock & { _recurring?: boolean })[], svg: SVGSVGElement): void {
  const legend = qId('block-legend');
  legend.innerHTML = '';

  if (!blocks.length) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:12px;color:var(--text-muted)';
    hint.textContent = 'Drag on the clock ring to add a time block';
    legend.appendChild(hint);
    return;
  }

  blocks.forEach(block => {
    const chip = document.createElement('span');
    chip.className = 'block-chip' + (isSelectedScheduleBlock(key, block.id) ? ' is-selected' : '');
    chip.textContent = block._recurring ? block.label + ' \u21BB' : block.label;
    applyBlockGradientStyle(chip, block);
    chip.title = formatBlockTimeRange(block);
    chip.addEventListener('click', () => selectScheduleBlock(key, block.id));
    legend.appendChild(chip);
  });
}

function formatClockMinutes(min: number, ampm = ''): string {
  const h = Math.floor(min / 60) % 12 || 12;
  const m = min % 60;
  const base = `${h}:${String(m).padStart(2, '0')}`;
  return ampm ? `${base} ${ampm}` : base;
}

function getBlockEndAmPm(block: { startMin: number; endMin: number; ampm: AmPm }): AmPm {
  return block.endMin < block.startMin
    ? (block.ampm === 'AM' ? 'PM' : 'AM')
    : block.ampm;
}

function formatBlockTimeRange(block: { startMin: number; endMin: number; ampm: AmPm }): string {
  return `${formatClockMinutes(block.startMin, block.ampm)} – ${formatClockMinutes(block.endMin, getBlockEndAmPm(block))}`;
}

function updateClockHand(fromInterval = false): void {
  const hand = document.getElementById('clock-hand') as SVGLineElement | null;
  if (!hand) return;
  const now = new Date();
  const min = (now.getHours() % 12) * 60 + now.getMinutes();
  const ang = (min / 720) * 2 * Math.PI - Math.PI / 2;
  const cx = 200, cy = 200, R = 170;
  const r1 = Math.round(R * 0.62);
  hand.setAttribute('x1', String(cx + 10 * Math.cos(ang)));
  hand.setAttribute('y1', String(cy + 10 * Math.sin(ang)));
  hand.setAttribute('x2', String(cx + r1 * Math.cos(ang)));
  hand.setAttribute('y2', String(cy + r1 * Math.sin(ang)));

  if (fromInterval) {
    const expected: AmPm = now.getHours() < 12 ? 'AM' : 'PM';
    if (clockAmPm !== expected) {
      clockAmPm = expected;
      (document.querySelectorAll('.ampm-btn') as NodeListOf<HTMLElement>)
        .forEach(b => b.classList.toggle('active', b.dataset.ampm === clockAmPm));
      if (activeView === 'schedule' && scheduleDate) renderScheduleView(scheduleDate);
    }
  }
}
