import { useRef, useState } from 'react';
import { useCalderaTabs, type CalendarTab } from './useCalderaTabs';
import { ConfirmDialog } from './ConfirmDialog';

// Browser-style tab bar: each tab is an independent calendar. Click to switch,
// double-click to rename inline, × to delete (kept hidden when only one remains),
// drag to reorder, + to add. Tabs persist across restarts via the workspace file.
export function TabBar({ onOpenAi }: { onOpenAi: () => void }) {
  const { tabs, activeId, setActive, create, rename, close, reorder } = useCalderaTabs();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [pendingClose, setPendingClose] = useState<CalendarTab | null>(null);

  function startRename(tab: CalendarTab) {
    setEditingId(tab.id);
    setDraft(tab.name);
  }

  function commitRename() {
    if (editingId) rename(editingId, draft);
    setEditingId(null);
    setDraft('');
  }

  return (
    <div className="tabbar">
      <div className="tabbar-tabs">
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={
              'cal-tab' +
              (tab.id === activeId ? ' active' : '') +
              (index === dragOverIndex ? ' drag-over' : '')
            }
            draggable={editingId !== tab.id}
            title={tab.name}
            onClick={() => { if (editingId !== tab.id) setActive(tab.id); }}
            onDoubleClick={() => startRename(tab)}
            onDragStart={() => { dragIndex.current = index; }}
            onDragOver={(event) => { event.preventDefault(); setDragOverIndex(index); }}
            onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== index) reorder(dragIndex.current, index);
              dragIndex.current = null;
              setDragOverIndex(null);
            }}
            onDragEnd={() => { dragIndex.current = null; setDragOverIndex(null); }}
          >
            {editingId === tab.id ? (
              <input
                className="cal-tab-input"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitRename}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename();
                  else if (event.key === 'Escape') { setEditingId(null); setDraft(''); }
                }}
              />
            ) : (
              <>
                <span className="cal-tab-name">{tab.name}</span>
                {tabs.length > 1 && (
                  <button
                    className="cal-tab-close"
                    title="Delete calendar"
                    onClick={(event) => { event.stopPropagation(); setPendingClose(tab); }}
                  >
                    &#10005;
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <button className="tabbar-add" title="New calendar" onClick={() => create()}>+</button>
      <button className="tabbar-add tabbar-import" title="Event Import" aria-label="Event Import" onClick={onOpenAi}>
        {/* Lucide calendar-plus — opens the AI event import */}
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
          <path d="M3 10h18" />
          <path d="M16 19h6" />
          <path d="M19 16v6" />
        </svg>
      </button>

      {pendingClose && (
        <ConfirmDialog
          title={`Delete “${pendingClose.name}”?`}
          message="This calendar's events and tasks will be removed permanently. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => { close(pendingClose.id); setPendingClose(null); }}
          onCancel={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}
