import { useState } from 'react';
import { SchedulePage } from '../schedule/SchedulePage';
import type { CalMode } from '../schedule/ScheduleNav';
import { PlaceholderLens } from './PlaceholderLens';
import { MoneyLens } from './money/MoneyLens';
import type { LensId } from './lenses';

// Owns which framework lens the active project is being viewed through. The Time lens is
// the existing schedule view; the other five are placeholders for now. Lens choice is
// local UI state (defaults to Time) — persisting it per project is a later nicety.
export function ProjectWorkspace({
  externalDate,
  mode,
  onModeChange,
  onOpenDay,
  onHoverDateChange,
  onOpenAi,
}: {
  externalDate?: string;
  mode: CalMode;
  onModeChange: (mode: CalMode) => void;
  onOpenDay: (key: string) => void;
  onHoverDateChange: (key: string | null) => void;
  onOpenAi: () => void;
}) {
  const [lens, setLens] = useState<LensId>('time');

  if (lens === 'time') {
    return (
      <SchedulePage
        externalDate={externalDate}
        mode={mode}
        onModeChange={onModeChange}
        onOpenDay={onOpenDay}
        onHoverDateChange={onHoverDateChange}
        onOpenAi={onOpenAi}
        lens={lens}
        onSelectLens={setLens}
      />
    );
  }

  if (lens === 'money') {
    return <MoneyLens lens={lens} onSelectLens={setLens} />;
  }

  return <PlaceholderLens lens={lens} onSelectLens={setLens} />;
}
