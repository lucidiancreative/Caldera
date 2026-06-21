import type { ReactNode } from 'react';
import { LensBar } from './LensBar';
import type { LensId } from './lenses';

// The two-column shell shared by every lens: a sidebar (LensBar pinned on top, then the
// lens's own list) and a main area. Keeping the LensBar and column structure here means
// every lens lines up identically — each lens only supplies its `sidebar` and `main`.
// `children` is for lens-level overlays (e.g. the Time lens's block editor modal).
export function LensLayout({
  lens,
  onSelectLens,
  sidebar,
  main,
  children,
}: {
  lens: LensId;
  onSelectLens: (lens: LensId) => void;
  sidebar: ReactNode;
  main: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="react-schedule">
      <div className="react-schedule-body">
        <aside className="lens-sidebar">
          <LensBar active={lens} onSelect={onSelectLens} />
          <div className="task-sidebar">{sidebar}</div>
        </aside>
        <div className="react-schedule-main">{main}</div>
      </div>
      {children}
    </div>
  );
}
