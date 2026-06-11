import { useEffect, useState } from 'react';

export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return tick;
}
