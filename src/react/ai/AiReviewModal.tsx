import { useState } from 'react';
import type { AiEvent } from '../../types';
import { addAiEvents } from '../store/calendarActions';
import { useCalData } from '../store/calStore';
import { formatDisplayDate, formatTime12h } from '../util/format';

export function AiReviewModal({
  events,
  onClose,
}: {
  events: AiEvent[];
  onClose: () => void;
}) {
  const calData = useCalData();
  const [selected, setSelected] = useState<boolean[]>(() => events.map(() => true));

  async function addSelected() {
    const picked = events.filter((_event, index) => selected[index]);
    if (picked.length === 0) {
      onClose();
      return;
    }
    await addAiEvents(calData, picked);
    onClose();
  }

  return (
    <div id="ai-review-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div id="ai-review-modal">
        <button id="ai-review-close" onClick={onClose}>&#10005;</button>
        <h2 id="ai-review-title">Found {events.length} Event{events.length === 1 ? '' : 's'}</h2>
        <p id="ai-review-subtitle" className="ai-review-subtitle">Select the events you want to add to your calendar.</p>
        <div id="ai-event-list">
          {events.map((event, index) => (
            <div
              key={`${event.title}-${index}`}
              className={'ai-event-row' + (selected[index] ? ' checked' : '')}
              onClick={() => {
                setSelected((current) => current.map((value, currentIndex) => currentIndex === index ? !value : value));
              }}
            >
              <input
                type="checkbox"
                checked={selected[index]}
                onChange={() => {
                  setSelected((current) => current.map((value, currentIndex) => currentIndex === index ? !value : value));
                }}
                onClick={(clickEvent) => clickEvent.stopPropagation()}
              />
              <div className="ai-event-info">
                <div className="ai-event-title">{event.title}</div>
                <div className="ai-event-meta">
                  {formatDisplayDate(event.date)}
                  {event.time ? ` · ${formatTime12h(event.time)}` : ''}
                  {event.sourceUrl ? (
                    <>
                      {' · '}
                      <span
                        className="ai-event-link"
                        title={event.sourceUrl}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          window.calAPI.openExternal(event.sourceUrl);
                        }}
                      >
                        {safeHostname(event.sourceUrl)}
                      </span>
                    </>
                  ) : null}
                </div>
                {event.notes ? <div className="ai-event-notes">{event.notes}</div> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="ai-review-actions">
          <button id="ai-select-all-btn" className="ai-btn-secondary" onClick={() => setSelected(events.map(() => true))}>Select All</button>
          <button id="ai-deselect-all-btn" className="ai-btn-secondary" onClick={() => setSelected(events.map(() => false))}>Deselect All</button>
          <span className="ai-review-spacer" />
          <button id="ai-add-selected-btn" className="ai-btn-accent" onClick={() => void addSelected()}>Add to Calendar</button>
        </div>
      </div>
    </div>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
