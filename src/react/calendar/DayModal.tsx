import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CalData, CalendarEvent, DayData } from '../../types';
import { useCalData } from '../store/calStore';
import {
  addEmptyEvent,
  addEventFromPath,
  assignEventImage,
  removeEvent,
  removeEventImage,
  saveEventField,
  setFeaturedCalendarEvent,
} from '../store/calendarActions';
import { useResolvedImage } from '../hooks/useResolvedImage';
import { formatDisplayDate } from '../util/format';

interface DayModalProps {
  dayKey: string;
  onClose: () => void;
  onOpenLightbox: (url: string) => void;
  onScheduleDay: (key: string) => void;
}

function getDayData(calData: CalData, key: string): DayData | undefined {
  const value = calData[key];
  if (value && typeof value === 'object' && 'events' in value) return value as DayData;
  return undefined;
}

export function DayModal({ dayKey, onClose, onOpenLightbox, onScheduleDay }: DayModalProps) {
  const calData = useCalData();
  const day = getDayData(calData, dayKey);
  const events = day?.events || [];

  return (
    <div id="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div id="modal">
        <button id="modal-close" onClick={onClose}>&#10005;</button>
        <div id="modal-header">
          <h2 id="modal-date">{formatDisplayDate(dayKey)}</h2>
          <div id="modal-header-actions">
            <button id="btn-schedule-day" onClick={() => onScheduleDay(dayKey)}>&#9202; Schedule</button>
            <button id="btn-add-event" onClick={() => void addEmptyEvent(calData, dayKey)}>+ Add Event</button>
          </div>
        </div>

        <div id="event-cards">
          {events.map((event) => (
            <EventCard
              key={event.id}
              calData={calData}
              dayKey={dayKey}
              event={event}
              isFeatured={event.id === day?.featuredId}
              onOpenLightbox={onOpenLightbox}
            />
          ))}

          <DropZone
            label={events.length === 0
              ? 'Drop an image here or click “+ Add Event” to get started'
              : '+ Drop an image here to add another event'}
            onDropPath={(path) => addEventFromPath(calData, dayKey, path)}
          />
        </div>
      </div>
    </div>
  );
}

function EventCard({
  calData,
  dayKey,
  event,
  isFeatured,
  onOpenLightbox,
}: {
  calData: CalData;
  dayKey: string;
  event: CalendarEvent;
  isFeatured: boolean;
  onOpenLightbox: (url: string) => void;
}) {
  const imageUrl = useResolvedImage(event.image);
  const [notes, setNotes] = useState(event.notes || '');

  useEffect(() => {
    setNotes(event.notes || '');
  }, [event.notes, event.id]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (notes !== (event.notes || '')) {
        void saveEventField(calData, dayKey, event.id, 'notes', notes.trim());
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [notes, event.notes, calData, dayKey, event.id]);

  return (
    <div className={'event-card' + (isFeatured ? ' featured' : '')} data-id={event.id}>
      <div className="card-toolbar">
        <button
          className="btn-cover"
          title={isFeatured ? 'Calendar cover' : 'Set as calendar cover'}
          onClick={() => { if (!isFeatured) void setFeaturedCalendarEvent(calData, dayKey, event.id); }}
        >
          {isFeatured ? '\u2605' : '\u2606'}
        </button>
        <span className="cover-label" style={{ display: isFeatured ? '' : 'none' }}>Cover</span>
        <span className="card-spacer" />
        <button
          className="card-action-btn"
          title="Assign image via file dialog"
          onClick={async () => {
            const srcPath = await window.calAPI.openFileDialog();
            if (srcPath) await assignEventImage(calData, dayKey, event.id, srcPath);
          }}
        >
          &#128247; Assign
        </button>
        <button
          className="card-action-btn"
          title="Remove image"
          style={{ display: event.image ? '' : 'none' }}
          onClick={() => void removeEventImage(calData, dayKey, event.id)}
        >
          &#128465; Remove
        </button>
        <button
          className="card-action-btn btn-del-card"
          title="Delete this event"
          onClick={() => void removeEvent(calData, dayKey, event.id)}
        >
          &#10005;
        </button>
      </div>

      <DropZone
        className={'card-image-area' + (event.image ? ' has-image' : '')}
        label="Drop image here or use Assign"
        onDropPath={(path) => assignEventImage(calData, dayKey, event.id, path)}
      >
        <img
          className={'card-img' + (event.image ? '' : ' hidden')}
          alt=""
          src={imageUrl}
          draggable={false}
          onClick={() => { if (imageUrl) onOpenLightbox(imageUrl); }}
        />
        {!event.image && <div className="card-no-img">Drop image here or use Assign</div>}
      </DropZone>

      <div className="card-fields">
        <div className="card-time-row">
          <label>Time</label>
          <input
            type="time"
            className="card-time"
            value={event.time || ''}
            onChange={(inputEvent) => void saveEventField(calData, dayKey, event.id, 'time', inputEvent.target.value)}
          />
        </div>

        <textarea
          className="card-notes"
          placeholder="Notes…"
          value={notes}
          onChange={(inputEvent) => setNotes(inputEvent.target.value)}
        />
      </div>
    </div>
  );
}

function DropZone({
  className = 'modal-add-zone',
  children,
  label,
  onDropPath,
}: {
  className?: string;
  children?: ReactNode;
  label: string;
  onDropPath: (path: string) => Promise<void>;
}) {
  const [dragCount, setDragCount] = useState(0);

  async function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragCount(0);
    const file = event.dataTransfer.files[0];
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    await onDropPath(window.calAPI.getPathForFile(file));
  }

  return (
    <div
      className={className + (dragCount > 0 ? ' drag-over' : '')}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragCount((value) => value + 1);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragLeave={() => setDragCount((value) => Math.max(0, value - 1))}
      onDrop={onDrop}
    >
      {children}
      {!children && label}
    </div>
  );
}
