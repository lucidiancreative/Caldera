import { useEffect, useState } from 'react';
import { resolveCalendarImageUrl } from '../store/calendarActions';

export function useResolvedImage(relPath: string | null | undefined): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!relPath) {
      setUrl('');
      return;
    }
    resolveCalendarImageUrl(relPath)
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [relPath]);

  return url;
}
