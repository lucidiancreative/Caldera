// Create/edit a schedule block. Mirrors the vanilla block popup's fields (label,
// AM/PM, recurrence, and an all/today scope for recurring edits) but as a centered
// React modal. Writes go through the schedule bridge. An empty label deletes (edit)
// or cancels (create), matching the vanilla behavior.
import { useEffect, useState } from 'react';
import type { ScheduleBlock } from '../store/selectors';
import { createBlock, updateBlock, deleteBlock } from '../store/actions';
import { formatBlockTimeRange } from '../util/format';

export type EditorTarget =
  | { mode: 'edit'; date: string; block: ScheduleBlock }
  | { mode: 'create'; date: string; startMin: number; endMin: number; ampm: 'AM' | 'PM' };

interface BlockEditorProps {
  target: EditorTarget;
  onClose: () => void;
}

export function BlockEditor({ target, onClose }: BlockEditorProps) {
  const isEdit = target.mode === 'edit';
  const block = target.mode === 'edit' ? target.block : null;
  const isRecurring = !!block?.recurring;

  const [label, setLabel] = useState(block?.label ?? '');
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(target.mode === 'edit' ? target.block.ampm : target.ampm);
  const [recurrence, setRecurrence] = useState<string>(block?.recurring ? block.recurrence ?? 'daily' : 'none');
  const [scope, setScope] = useState<'all' | 'today'>('all');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const timeRange = target.mode === 'edit'
    ? formatBlockTimeRange(target.block)
    : formatBlockTimeRange({ startMin: target.startMin, endMin: target.endMin, ampm });

  async function save() {
    const trimmed = label.trim();
    if (!trimmed) {
      if (target.mode === 'edit') await deleteBlock(target.date, target.block.id, isRecurring ? scope : undefined);
      onClose();
      return;
    }
    if (target.mode === 'edit') {
      await updateBlock(target.date, target.block.id, trimmed, recurrence, scope, ampm);
    } else {
      await createBlock(target.date, { startMin: target.startMin, endMin: target.endMin, label: trimmed }, recurrence, ampm);
    }
    onClose();
  }

  async function remove() {
    if (target.mode === 'edit') await deleteBlock(target.date, target.block.id, isRecurring ? scope : undefined);
    onClose();
  }

  return (
    <div className="rblock-editor-overlay" onClick={onClose}>
      <div className="rblock-editor" onClick={(event) => event.stopPropagation()}>
        <div className="rblock-editor-head">
          <h3>{isEdit ? 'Edit block' : 'New block'}</h3>
          <span className="rblock-editor-time">{timeRange}</span>
        </div>

        <input
          className="rblock-editor-input"
          placeholder="Label this block…"
          value={label}
          autoFocus
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void save(); }}
        />

        <div className="rblock-editor-row">
          <label>AM/PM
            <select value={ampm} onChange={(event) => setAmpm(event.target.value as 'AM' | 'PM')}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </label>
          <label>Repeat
            <select value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>
              <option value="none">No repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
        </div>

        {isEdit && isRecurring && (
          <div className="rblock-editor-scope">
            <label><input type="radio" name="rb-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All occurrences</label>
            <label><input type="radio" name="rb-scope" checked={scope === 'today'} onChange={() => setScope('today')} /> Just today</label>
          </div>
        )}

        <div className="rblock-editor-actions">
          <button className="rblock-editor-save" onClick={() => void save()}>Save</button>
          {isEdit
            ? <button className="rblock-editor-del" onClick={() => void remove()}>Delete</button>
            : <button className="rblock-editor-cancel" onClick={onClose}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
