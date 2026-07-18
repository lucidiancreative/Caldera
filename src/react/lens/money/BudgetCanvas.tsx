import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
// RGL's base positioning rules live in styles.css (the renderer's single, CSP-linked
// stylesheet) rather than importing the library CSS — this IIFE bundle can't emit/link a
// separate CSS file, and we only need the drag/transition rules (resize is disabled).
import type { Budget, BudgetSectionKind, CalData } from '../../../types';
import { addSection, setSectionsLayout } from '../../store/moneyActions';
import { BUDGET_KINDS, BUDGET_KIND_ORDER, SUMMARY_CARD_ID } from './budgetKinds';
import { BudgetSection } from './BudgetSection';
import { BudgetSummary } from './BudgetSummary';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

// The draggable, snap-to-grid dashboard for a budget. Lazy-loaded (this is the only module
// that pulls in react-grid-layout), so RGL never touches app startup evaluation.
const GridLayout = WidthProvider(RGL);
const COLS = 12;
const ROW_HEIGHT = 8;
const MARGIN: [number, number] = [12, 12];
const DEFAULT_W = 4;
const ROW_STEP = ROW_HEIGHT + MARGIN[1];

interface Card {
  id: string;
  layout?: { x: number; y: number; w: number };
}

// A card's row-unit height from its measured content height (RGL has no auto-height).
function rowsForHeight(px: number | undefined): number {
  return Math.max(2, Math.ceil(((px ?? 160) + MARGIN[1]) / ROW_STEP));
}

// Stored position when placed, else auto-flow across the row.
function buildLayout(cards: Card[], heights: Record<string, number>): Layout {
  let autoX = 0;
  let autoY = 0;
  return cards.map((card) => {
    const h = rowsForHeight(heights[card.id]);
    if (card.layout) return { i: card.id, x: card.layout.x, y: card.layout.y, w: card.layout.w, h };
    if (autoX + DEFAULT_W > COLS) { autoX = 0; autoY += 8; }
    const item = { i: card.id, x: autoX, y: autoY, w: DEFAULT_W, h };
    autoX += DEFAULT_W;
    return item;
  });
}

export default function BudgetCanvas({ calData, budget }: { calData: CalData; budget: Budget }) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const setHeight = useCallback((id: string, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  const cards: Card[] = [
    ...budget.sections.map((section) => ({ id: section.id, layout: section.layout })),
    { id: SUMMARY_CARD_ID, layout: budget.summaryLayout },
  ];
  // Signature of the stored structure + positions. When it changes (switch budget, add /
  // remove / duplicate section, undo), we re-seed the controlled layout from the store.
  const signature = budget.id + '|' + cards.map((card) => card.id + (card.layout ? `@${card.layout.x},${card.layout.y},${card.layout.w}` : '')).join('|');

  // RGL is CONTROLLED by this state. Keeping the layout in state — rather than deriving a
  // fresh array on every render — is what makes dragging work: an unrelated re-render during
  // a drag would otherwise hand RGL a conflicting layout and cancel/revert the drag. The
  // layout only changes when RGL reports a drop, when heights settle, or when the stored
  // structure changes (below).
  const [layout, setLayout] = useState<Layout>(() => buildLayout(cards, heights));
  const sigRef = useRef(signature);
  if (sigRef.current !== signature) {
    sigRef.current = signature;
    setLayout(buildLayout(cards, heights)); // adjust-state-during-render (same component) — safe
  }

  // Keep each card's row-height in step with its measured content, without moving it.
  useEffect(() => {
    setLayout((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const h = rowsForHeight(heights[item.i]);
        if (item.h === h) return item;
        changed = true;
        return { ...item, h };
      });
      return changed ? next : prev;
    });
  }, [heights]);

  function handleLayoutChange(next: Layout) {
    setLayout(next); // reflect the drop immediately so RGL doesn't snap back
    void setSectionsLayout(calData, budget.id, next.map((entry) => ({ id: entry.i, x: entry.x, y: entry.y, w: entry.w })));
  }

  function addSectionAtCursor(kind: BudgetSectionKind) {
    const rect = wrapRef.current?.getBoundingClientRect();
    let placement: { x: number; y: number; w: number } | undefined;
    if (rect && canvasMenu) {
      const colWidth = rect.width / COLS;
      const scrollTop = wrapRef.current?.scrollTop ?? 0;
      placement = {
        x: Math.max(0, Math.min(COLS - DEFAULT_W, Math.floor((canvasMenu.x - rect.left) / colWidth))),
        y: Math.max(0, Math.floor((canvasMenu.y - rect.top + scrollTop) / ROW_STEP)),
        w: DEFAULT_W,
      };
    }
    void addSection(calData, budget.id, kind, placement);
  }

  const canvasMenuItems: ContextMenuItem[] = BUDGET_KIND_ORDER.map((kind) => ({
    label: `Add ${BUDGET_KINDS[kind].defaultTitle}`,
    onClick: () => addSectionAtCursor(kind),
  }));

  function openCanvasMenu(event: MouseEvent) {
    event.preventDefault();
    setCanvasMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <div className="budget-canvas-wrap" ref={wrapRef} onContextMenu={openCanvasMenu}>
      <GridLayout
        className="budget-canvas"
        layout={layout}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        isResizable={false}
        isDraggable
        draggableHandle=".budget-drag-grip"
        compactType="vertical"
        onLayoutChange={handleLayoutChange}
      >
        {budget.sections.map((section) => (
          <div key={section.id} className="budget-card">
            <BudgetSection calData={calData} budgetId={budget.id} section={section} onMeasure={setHeight} />
          </div>
        ))}
        <div key={SUMMARY_CARD_ID} className="budget-card">
          <BudgetSummary budget={budget} onMeasure={setHeight} />
        </div>
      </GridLayout>

      {canvasMenu && <ContextMenu x={canvasMenu.x} y={canvasMenu.y} items={canvasMenuItems} onClose={() => setCanvasMenu(null)} />}
    </div>
  );
}
