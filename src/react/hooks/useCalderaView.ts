import { useEffect, useState } from 'react';
import type { ViewType } from '../../types';

export function useCalderaView() {
  const bridge = window.calderaView;
  const [activeView, setActiveView] = useState<ViewType>(bridge?.activeView() ?? 'calendar');
  const [scheduleDate, setScheduleDateState] = useState<string | null>(bridge?.scheduleDate() ?? null);

  useEffect(() => {
    if (!bridge) return;
    const sync = () => {
      setActiveView(bridge.activeView());
      setScheduleDateState(bridge.scheduleDate());
    };
    sync();
    return bridge.subscribe(sync);
  }, [bridge]);

  return {
    activeView,
    scheduleDate,
    setActiveView: (view: ViewType) => bridge?.setActiveView(view),
    setScheduleDate: (key: string) => bridge?.setScheduleDate(key),
  };
}
