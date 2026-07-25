import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

// A themed right-click menu rendered to a body portal at the cursor. Closes on outside
// mousedown or Escape (same idiom as ConfirmDialog). Used for both the canvas "add section"
// menu and each section's action menu. `footer` renders extra controls below the items
// (e.g. colour swatches) that shouldn't auto-close the menu when used.
export function ContextMenu({ x, y, items, footer, onClose }: { x: number; y: number; items: ContextMenuItem[]; footer?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Added after the opening right-click has already fired, so it won't self-close.
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Clamp inside the viewport so an edge right-click stays fully visible.
  const estimatedHeight = items.length * 32 + (footer ? 64 : 0) + 16;
  const style: CSSProperties = {
    left: Math.min(x, window.innerWidth - 210),
    top: Math.min(y, window.innerHeight - estimatedHeight),
  };

  return createPortal(
    <div ref={ref} className="budget-ctx-menu" style={style} role="menu" onContextMenu={(event) => event.preventDefault()}>
      {items.map((item, index) => (
        <div key={index}>
          {item.separatorBefore && <div className="budget-ctx-sep" />}
          <button
            className={'budget-ctx-item' + (item.danger ? ' danger' : '')}
            role="menuitem"
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.label}
          </button>
        </div>
      ))}
      {footer && (
        <>
          <div className="budget-ctx-sep" />
          {footer}
        </>
      )}
    </div>,
    document.body,
  );
}
