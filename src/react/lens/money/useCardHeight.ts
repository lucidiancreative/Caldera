import { useEffect, useRef } from 'react';

// Reports a card's rendered height (via ResizeObserver) up to BudgetCanvas, which turns it
// into react-grid-layout row units so each item's box fits its content — RGL has no native
// auto-height. `onMeasure` must be stable (BudgetCanvas passes a useCallback) so the
// observer is created once per card.
export function useCardHeight(id: string, onMeasure?: (id: string, height: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onMeasure) return;
    const report = () => onMeasure(id, el.offsetHeight);
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [id, onMeasure]);
  return ref;
}
