import { useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

// A themed right-click menu rendered to a body portal at the cursor. Closes on outside
// mousedown or Escape (same idiom as ConfirmDialog). Used for both the canvas "add section"
// menu and each section's action menu.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
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
  const style: CSSProperties = {
    left: Math.min(x, window.innerWidth - 210),
    top: Math.min(y, window.innerHeight - (items.length * 32 + 16)),
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
    </div>,
    document.body,
  );
}
