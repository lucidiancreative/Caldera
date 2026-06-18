import { useEffect, useState } from 'react';

// The single focused date shared by all lenses (Month/Week/Day). Owned by the vanilla
// data layer so it survives the React boundary; this hook mirrors it and writes back.
export function useCalderaView() {
  const bridge = window.calderaView;
  const [scheduleDate, setScheduleDateState] = useState<string | null>(bridge?.scheduleDate() ?? null);

  useEffect(() => {
    if (!bridge) return;
    const sync = () => setScheduleDateState(bridge.scheduleDate());
    sync();
    return bridge.subscribe(sync);
  }, [bridge]);

  return {
    scheduleDate,
    setScheduleDate: (key: string) => bridge?.setScheduleDate(key),
  };
}
