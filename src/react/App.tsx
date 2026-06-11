import { useEffect, useState } from 'react';
import type { AiEvent } from '../types';
import { AiImportModal } from './ai/AiImportModal';
import { AiReviewModal } from './ai/AiReviewModal';
import { CalendarView, initialMonthState, monthLabel } from './calendar/CalendarView';
import { DayModal } from './calendar/DayModal';
import { useCalderaView } from './hooks/useCalderaView';
import { addEventFromImageBuffer } from './store/calendarActions';
import { useCalData } from './store/calStore';
import { SchedulePage } from './schedule/SchedulePage';
import { SettingsModal } from './settings/SettingsModal';
import { MONTH_TAB_LABELS, getTodayKey } from './util/format';

export function App() {
  const { activeView, scheduleDate, setActiveView, setScheduleDate } = useCalderaView();
  const calData = useCalData();
  const [{ month, year }, setMonthState] = useState(initialMonthState);
  const [dayModalDate, setDayModalDate] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiReviewEvents, setAiReviewEvents] = useState<AiEvent[] | null>(null);
  const [pasteTargetDate, setPasteTargetDate] = useState<string | null>(null);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const targetKey = dayModalDate || pasteTargetDate;
      if (!targetKey) return;

      for (const item of Array.from(event.clipboardData?.items ?? [])) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(item.type)) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        const ext = item.type === 'image/png' ? '.png' : item.type === 'image/webp' ? '.webp' : '.jpg';
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await addEventFromImageBuffer(calData, targetKey, bytes, ext);
        break;
      }
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [calData, dayModalDate, pasteTargetDate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (aiReviewEvents) {
        setAiReviewEvents(null);
        return;
      }
      if (aiOpen) {
        setAiOpen(false);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (lightboxUrl) {
        setLightboxUrl('');
        return;
      }
      if (dayModalDate) {
        setDayModalDate(null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [aiOpen, aiReviewEvents, dayModalDate, lightboxUrl, settingsOpen]);

  function changeMonth(delta: number) {
    setMonthState((current) => {
      let nextMonth = current.month + delta;
      let nextYear = current.year;
      if (nextMonth < 0) {
        nextMonth = 11;
        nextYear -= 1;
      }
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear += 1;
      }
      return { month: nextMonth, year: nextYear };
    });
    if (activeView !== 'calendar') setActiveView?.('calendar');
  }

  function changeYear(delta: number) {
    setMonthState((current) => ({ ...current, year: current.year + delta }));
    if (activeView !== 'calendar') setActiveView?.('calendar');
  }

  function openDay(key: string) {
    setScheduleDate?.(key);
    setDayModalDate(key);
  }

  function openSchedule(key: string) {
    setDayModalDate(null);
    setScheduleDate?.(key);
    setActiveView?.('schedule');
  }

  return (
    <>
      <div id="titlebar">
        <img id="app-icon" src="build/icon.png" alt="" />
        <span id="app-name">Caldera</span>
        <div id="win-controls">
          <button id="btn-min" title="Minimize" onClick={() => window.calAPI.winMinimize()}>&#8211;</button>
          <button id="btn-max" title="Maximize" onClick={() => window.calAPI.winMaximize()}>&#9633;</button>
          <button id="btn-close" title="Close" onClick={() => window.calAPI.winClose()}>&#10005;</button>
        </div>
      </div>

      <div id="month-strip">
        <div id="month-nav-area">
          <button id="prev-year" className="nav-arrow" title="Previous year" onClick={() => changeYear(-1)}>&#171;</button>
          <button id="prev-month" className="nav-arrow" title="Previous month" onClick={() => changeMonth(-1)}>&#8249;</button>
          <span id="current-label">{monthLabel(year, month)}</span>
          <button id="next-month" className="nav-arrow" title="Next month" onClick={() => changeMonth(1)}>&#8250;</button>
          <button id="next-year" className="nav-arrow" title="Next year" onClick={() => changeYear(1)}>&#187;</button>
        </div>

        <div id="month-tabs">
          {MONTH_TAB_LABELS.map((label, index) => (
            <button
              key={label}
              className={'month-tab' + (index === month ? ' active' : '')}
              data-month={index}
              onClick={() => {
                setMonthState((current) => ({ ...current, month: index }));
                if (activeView !== 'calendar') setActiveView?.('calendar');
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div id="view-tabs">
          <button className="view-tab" id="btn-ai" title="Event Import" onClick={() => setAiOpen(true)}>&#9733;</button>
          <button className={'view-tab' + (activeView === 'calendar' ? ' active' : '')} data-view="calendar" onClick={() => setActiveView?.('calendar')}>Calendar</button>
          <button
            className={'view-tab' + (activeView === 'schedule' ? ' active' : '')}
            data-view="schedule"
            onClick={() => {
              if (!scheduleDate) setScheduleDate?.(getTodayKey());
              setActiveView?.('schedule');
            }}
          >
            Schedule
          </button>
        </div>
      </div>

      {activeView === 'calendar' ? (
        <CalendarView month={month} year={year} onOpenDay={openDay} onHoverDateChange={setPasteTargetDate} />
      ) : (
        <div id="schedule-view">
          <SchedulePage externalDate={scheduleDate ?? undefined} />
        </div>
      )}

      {dayModalDate && (
        <DayModal
          dayKey={dayModalDate}
          onClose={() => setDayModalDate(null)}
          onOpenLightbox={setLightboxUrl}
          onScheduleDay={openSchedule}
        />
      )}

      {lightboxUrl && (
        <div id="lightbox-overlay" onClick={(event) => { if (event.target === event.currentTarget) setLightboxUrl(''); }}>
          <button id="lightbox-close" onClick={() => setLightboxUrl('')}>&#10005;</button>
          <img id="lightbox-img" alt="" src={lightboxUrl} />
        </div>
      )}

      <button id="btn-settings" title="Settings" onClick={() => setSettingsOpen(true)}>&#9881;</button>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {aiOpen && <AiImportModal onClose={() => setAiOpen(false)} onImported={setAiReviewEvents} />}
      {aiReviewEvents && <AiReviewModal events={aiReviewEvents} onClose={() => setAiReviewEvents(null)} />}
    </>
  );
}
