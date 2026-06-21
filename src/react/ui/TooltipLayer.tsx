import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type TooltipSource = 'pointer' | 'focus';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  source: TooltipSource;
  anchorX: number;
  anchorY: number;
}

const TOOLTIP_DATA_KEY = 'calderaTooltip';
const TOOLTIP_SELECTOR = '[title], [data-caldera-tooltip]';
const OFFSET_X = 12;
const OFFSET_Y = 14;
const VIEWPORT_MARGIN = 8;
const TOOLTIP_DELAY_MS = 450;

function getTooltipElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest(TOOLTIP_SELECTOR);
  return element instanceof HTMLElement ? element : null;
}

function getTooltipText(element: HTMLElement): string {
  const title = element.getAttribute('title');
  if (title && title.trim()) {
    element.dataset[TOOLTIP_DATA_KEY] = title.trim();
    element.removeAttribute('title');
  }

  return element.dataset[TOOLTIP_DATA_KEY]?.trim() || '';
}

function getFocusPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom + 8,
  };
}

export function TooltipLayer() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const pendingTooltipRef = useRef<TooltipState | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    function clearShowTimer() {
      if (showTimerRef.current === null) return;
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    function queueShow(element: HTMLElement, x: number, y: number, source: TooltipSource) {
      const text = getTooltipText(element);
      if (!text) return;
      clearShowTimer();
      activeElementRef.current = element;
      pendingTooltipRef.current = { text, x, y, anchorX: x, anchorY: y, source };
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        if (activeElementRef.current === element && pendingTooltipRef.current) {
          setTooltip(pendingTooltipRef.current);
        }
      }, TOOLTIP_DELAY_MS);
    }

    function hide(element?: HTMLElement | null) {
      if (element && activeElementRef.current !== element) return;
      clearShowTimer();
      pendingTooltipRef.current = null;
      activeElementRef.current = null;
      setTooltip(null);
    }

    function onPointerOver(event: PointerEvent) {
      const element = getTooltipElement(event.target);
      if (!element) return;
      queueShow(element, event.clientX + OFFSET_X, event.clientY + OFFSET_Y, 'pointer');
    }

    function onPointerMove(event: PointerEvent) {
      if (!activeElementRef.current) return;
      const next = {
        x: event.clientX + OFFSET_X,
        y: event.clientY + OFFSET_Y,
        anchorX: event.clientX + OFFSET_X,
        anchorY: event.clientY + OFFSET_Y,
      };
      if (pendingTooltipRef.current?.source === 'pointer') {
        pendingTooltipRef.current = { ...pendingTooltipRef.current, ...next };
      }
      setTooltip((current) => (
        current?.source === 'pointer'
          ? { ...current, ...next }
          : current
      ));
    }

    function onPointerOut(event: PointerEvent) {
      const element = activeElementRef.current;
      if (!element) return;
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      hide(element);
    }

    function onFocusIn(event: FocusEvent) {
      const element = getTooltipElement(event.target);
      if (!element) return;
      const position = getFocusPosition(element);
      queueShow(element, position.x, position.y, 'focus');
    }

    function onFocusOut(event: FocusEvent) {
      const element = getTooltipElement(event.target);
      hide(element);
    }

    function onViewportChange() {
      hide();
    }

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointercancel', onViewportChange, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    return () => {
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointercancel', onViewportChange, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      clearShowTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return;

    const rect = tooltipRef.current.getBoundingClientRect();
    const preferredY = tooltip.anchorY;
    const flippedY = tooltip.anchorY - rect.height - (OFFSET_Y * 2);
    const nextY = preferredY + rect.height + VIEWPORT_MARGIN > window.innerHeight
      ? flippedY
      : preferredY;
    const clampedX = Math.min(
      Math.max(tooltip.anchorX, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN),
    );
    const clampedY = Math.min(
      Math.max(nextY, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN),
    );

    if (clampedX !== tooltip.x || clampedY !== tooltip.y) {
      setTooltip((current) => current && { ...current, x: clampedX, y: clampedY });
    }
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={tooltipRef}
      className="app-tooltip"
      role="tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      {tooltip.text}
    </div>
  );
}
