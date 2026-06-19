import { useEffect, useState } from 'react';
import type { AiEvent } from '../types';
import { AiImportModal } from './ai/AiImportModal';
import { AiReviewModal } from './ai/AiReviewModal';
import { DayModal } from './calendar/DayModal';
import { useCalderaView } from './hooks/useCalderaView';
import { addEventFromImageBuffer } from './store/calendarActions';
import { useCalData } from './store/calStore';
import { SchedulePage } from './schedule/SchedulePage';
import type { CalMode } from './schedule/ScheduleNav';
import { SettingsModal } from './settings/SettingsModal';
import { TabBar } from './tabs/TabBar';
import { useCalderaTabs } from './tabs/useCalderaTabs';
import { getTodayKey } from './util/format';

export function App() {
  const { scheduleDate, setScheduleDate } = useCalderaView();
  const { activeId } = useCalderaTabs();
  const calData = useCalData();
  const [mode, setMode] = useState<CalMode>('month');
  const [dayModalDate, setDayModalDate] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiReviewEvents, setAiReviewEvents] = useState<AiEvent[] | null>(null);
  const [pasteTargetDate, setPasteTargetDate] = useState<string | null>(null);

  // The unified view always has a focused day; seed it to today on first mount so
  // every lens (Month/Daily/Timeline) and the sidebar share one defined date.
  useEffect(() => {
    if (!scheduleDate) setScheduleDate(getTodayKey());
  }, [scheduleDate, setScheduleDate]);

  // Switching calendars swaps the underlying data, so close any open day modal/lightbox
  // to avoid showing the previous calendar's content for the same date.
  useEffect(() => {
    setDayModalDate(null);
    setLightboxUrl('');
  }, [activeId]);

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

  function openDay(key: string) {
    setScheduleDate(key);
    setDayModalDate(key);
  }

  function openSchedule(key: string) {
    setDayModalDate(null);
    setScheduleDate(key);
    setMode('day');
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

      <TabBar onOpenAi={() => setAiOpen(true)} />

      <div id="schedule-view">
        <SchedulePage
          externalDate={scheduleDate ?? undefined}
          mode={mode}
          onModeChange={setMode}
          onOpenDay={openDay}
          onHoverDateChange={setPasteTargetDate}
        />
      </div>

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

      <button id="btn-settings" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        {/* Lucide settings (gear) */}
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {aiOpen && <AiImportModal onClose={() => setAiOpen(false)} onImported={setAiReviewEvents} />}
      {aiReviewEvents && <AiReviewModal events={aiReviewEvents} onClose={() => setAiReviewEvents(null)} />}
    </>
  );
}
