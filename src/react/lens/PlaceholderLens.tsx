import { LensLayout } from './LensLayout';
import { LENSES, type LensId } from './lenses';

// Scaffold for the five framework lenses we haven't built yet. Keeps the shared shell
// (LensBar + two columns) so switching between lenses feels complete while each one's
// real list + main panel get filled in stage by stage.
export function PlaceholderLens({ lens, onSelectLens }: { lens: LensId; onSelectLens: (lens: LensId) => void }) {
  const def = LENSES.find((entry) => entry.id === lens);
  const label = def?.label ?? 'Lens';

  return (
    <LensLayout
      lens={lens}
      onSelectLens={onSelectLens}
      sidebar={<div className="lens-empty">No {label.toLowerCase()} yet.</div>}
      main={
        <div className="lens-placeholder">
          <div className="lens-placeholder-title">{label}</div>
          <div className="lens-placeholder-note">Coming soon.</div>
        </div>
      }
    />
  );
}
