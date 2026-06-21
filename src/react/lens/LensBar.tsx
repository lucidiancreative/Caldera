import { LENSES, type LensId } from './lenses';

// The framework switcher pinned to the top of the sidebar. One icon per lens; the active
// lens is highlighted. Clicking a lens swaps the whole view (sidebar list + main area).
export function LensBar({ active, onSelect }: { active: LensId; onSelect: (lens: LensId) => void }) {
  return (
    <div className="lens-bar" role="tablist" aria-label="Project framework">
      {LENSES.map((lens) => (
        <button
          key={lens.id}
          className={'lens-icon lens-icon-' + lens.id + (lens.id === active ? ' active' : '')}
          role="tab"
          aria-selected={lens.id === active}
          title={lens.label}
          aria-label={lens.label}
          onClick={() => onSelect(lens.id)}
        >
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {lens.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
