import { useEffect, useState } from 'react';
import { SchedulePage } from './schedule/SchedulePage';

// The React island renders the Schedule page when the vanilla view router marks it
// active (the Schedule tab or a day's Schedule button), and nothing otherwise — the
// vanilla calendar still owns the Calendar view. The page mounts fresh each time
// Schedule is entered, reading the date the router set.
export function App() {
  const [active, setActive] = useState(() => window.calderaView?.activeView() === 'schedule');

  useEffect(() => {
    const view = window.calderaView;
    if (!view) return;
    const update = () => setActive(view.activeView() === 'schedule');
    update();
    return view.subscribe(update);
  }, []);

  if (!active) return null;
  return <SchedulePage initialDate={window.calderaView?.scheduleDate() ?? undefined} />;
}
