import { useEffect, useMemo, useState } from 'react';
import type { CalData, CalendarEvent, DayData } from '../../types';
import { useMinuteTick } from '../hooks/useMinuteTick';
import { useCalData } from '../store/calStore';
import { addEventFromPath, resolveCalendarImageUrl } from '../store/calendarActions';
import { MONTH_LABELS, WEEKDAY_LABELS, dateKey, formatTime12h, getTodayKey } from '../util/format';

interface CalendarViewProps {
  month: number;
  year: number;
  onOpenDay: (key: string) => void;
  onHoverDateChange: (key: string | null) => void;
}

function getDayData(calData: CalData, key: string): DayData | undefined {
  const value = calData[key];
  if (value && typeof value === 'object' && 'events' in value) return value as DayData;
  return undefined;
}

function getFeaturedEvent(day?: DayData): CalendarEvent | null {
  if (!day?.events?.length) return null;
  return day.events.find((event) => event.id === day.featuredId) || day.events[0];
}

function measureImageNaturalDimensions(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight });
    image.onerror = () => resolve({ w: 1, h: 1 });
    image.src = url;
  });
}

export function CalendarView({ month, year, onOpenDay, onHoverDateChange }: CalendarViewProps) {
  const calData = useCalData();
  useMinuteTick();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return (
    <div id="calendar-wrapper">
      <div id="calendar-header">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div id="calendar-grid">
        {Array.from({ length: firstDay }, (_, index) => (
          <div key={`blank-${index}`} className="day-cell empty" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const key = dateKey(year, month, day);
          return (
            <CalendarCell
              key={key}
              calData={calData}
              day={day}
              dateKeyValue={key}
              onHoverDateChange={onHoverDateChange}
              onOpenDay={onOpenDay}
            />
          );
        })}
      </div>
    </div>
  );
}

function CalendarCell({
  calData,
  day,
  dateKeyValue,
  onHoverDateChange,
  onOpenDay,
}: {
  calData: CalData;
  day: number;
  dateKeyValue: string;
  onHoverDateChange: (key: string | null) => void;
  onOpenDay: (key: string) => void;
}) {
  const todayKey = getTodayKey();
  const dayData = getDayData(calData, dateKeyValue);
  const featured = getFeaturedEvent(dayData);
  const [featuredUrl, setFeaturedUrl] = useState('');
  const [hovered, setHovered] = useState(false);
  const [stripUrls, setStripUrls] = useState<Array<{ url: string; height: number }>>([]);
  const [dragCount, setDragCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!featured?.image) {
      setFeaturedUrl('');
      return;
    }
    resolveCalendarImageUrl(featured.image)
      .then((url) => {
        if (!cancelled) setFeaturedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFeaturedUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [featured?.image]);

  useEffect(() => {
    let cancelled = false;
    if (!hovered) {
      setStripUrls([]);
      return;
    }
    const withImages = (dayData?.events || []).filter((event) => event.image);
    if (withImages.length <= 1) return;

    const ordered = [...withImages].sort((a, b) => {
      if (a.id === dayData?.featuredId) return -1;
      if (b.id === dayData?.featuredId) return 1;
      return 0;
    });

    Promise.all(
      ordered.map(async (event) => {
        const url = await resolveCalendarImageUrl(event.image!);
        const size = await measureImageNaturalDimensions(url);
        return { url, size };
      }),
    ).then((items) => {
      if (cancelled) return;
      const probe = document.querySelector(`.day-cell[data-date="${dateKeyValue}"]`) as HTMLElement | null;
      const cellHeight = probe?.offsetHeight || 150;
      const cellWidth = probe?.offsetWidth || 150;
      setStripUrls(items.map(({ url, size }) => ({
        url,
        height: Math.max(cellHeight, size.w > 0 ? Math.round((cellWidth * size.h) / size.w) : cellHeight),
      })));
    }).catch(() => {
      if (!cancelled) setStripUrls([]);
    });

    return () => {
      cancelled = true;
    };
  }, [hovered, dayData, dateKeyValue]);

  const stripDistance = useMemo(
    () => stripUrls.reduce((sum, item) => sum + item.height, 0),
    [stripUrls],
  );
  const stripDuration = useMemo(
    () => (stripDistance > 0 ? (stripDistance / 20).toFixed(2) : '0'),
    [stripDistance],
  );

  async function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragCount(0);
    const file = event.dataTransfer.files[0];
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    await addEventFromPath(calData, dateKeyValue, window.calAPI.getPathForFile(file));
  }

  return (
    <div
      className={[
        'day-cell',
        dateKeyValue === todayKey ? 'today' : '',
        dateKeyValue < todayKey ? 'past' : '',
        featured?.image ? 'has-image' : '',
        dragCount > 0 ? 'drag-over' : '',
      ].filter(Boolean).join(' ')}
      data-date={dateKeyValue}
      onClick={() => onOpenDay(dateKeyValue)}
      onMouseEnter={() => {
        setHovered(true);
        onHoverDateChange(dateKeyValue);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverDateChange(null);
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragCount((value) => value + 1);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragCount((value) => Math.max(0, value - 1))}
      onDrop={onDrop}
    >
      {featuredUrl && <div className="cell-bg" style={{ backgroundImage: `url("${featuredUrl}")` }} />}
      {stripUrls.length > 1 && (
        <div
          className="cell-scroll-strip"
          style={{
            ['--scroll-dist' as string]: `-${stripDistance}px`,
            animation: `cell-strip-scroll ${stripDuration}s linear infinite`,
          }}
        >
          {[...stripUrls, stripUrls[0]].map((item, index) => (
            <div
              key={`${item.url}-${index}`}
              className="cell-scroll-segment"
              style={{ backgroundImage: `url("${item.url}")`, height: item.height }}
            />
          ))}
        </div>
      )}

      <span className="day-num">{day}</span>
      {(dayData?.events?.length || 0) > 1 && <span className="cell-count">{dayData!.events.length}</span>}
      {featured?.time && <span className="cell-time">{formatTime12h(featured.time)}</span>}
    </div>
  );
}

export function initialMonthState(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth(), year: now.getFullYear() };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month]} ${year}`;
}
