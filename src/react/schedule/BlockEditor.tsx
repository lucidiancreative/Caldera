// Create/edit a schedule block. Mirrors the vanilla block popup's fields (label,
// AM/PM, recurrence, and an all/today scope for recurring edits) but as a centered
// React modal. Writes go through the schedule bridge. An empty label deletes (edit)
// or cancels (create), matching the vanilla behavior.
import { useEffect, useRef, useState } from 'react';
import type { ScheduleBlock } from '../store/selectors';
import { createBlock, updateBlock, deleteBlock } from '../store/actions';
import { formatBlockTimeRange } from '../util/format';
import { canSaveBlockEditorDraft } from './blockEditorValidation';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitLockRef = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isSubmitting) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSubmitting, onClose]);

  const timeRange = target.mode === 'edit'
    ? formatBlockTimeRange(target.block)
    : formatBlockTimeRange({ startMin: target.startMin, endMin: target.endMin, ampm });
  const createSaveEnabled = canSaveBlockEditorDraft(target.mode, label);

  async function save() {
    if (submitLockRef.current) return;
    const trimmed = label.trim();
    if (target.mode === 'create' && !trimmed) {
      setError('Enter a label to save this block.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError('');
    try {
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
    } catch (err) {
      console.error('Failed to save schedule block', err);
      setError('Could not save the block. Please try again.');
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function remove() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      if (target.mode === 'edit') await deleteBlock(target.date, target.block.id, isRecurring ? scope : undefined);
      onClose();
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rblock-editor-overlay" onClick={() => { if (!isSubmitting) onClose(); }}>
      <div className="rblock-editor" onClick={(event) => event.stopPropagation()}>
        <div className="rblock-editor-head">
          <h3>{isEdit ? 'Edit block' : 'New block'}</h3>
          <span className="rblock-editor-time">{timeRange}</span>
        </div>

        <form
          className="rblock-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input
            className="rblock-editor-input"
            placeholder="Label this block..."
            value={label}
            disabled={isSubmitting}
            autoFocus
            onChange={(event) => {
              setLabel(event.target.value);
              if (error) setError('');
            }}
          />

          <div className="rblock-editor-row">
            <label>AM/PM
              <select disabled={isSubmitting} value={ampm} onChange={(event) => setAmpm(event.target.value as 'AM' | 'PM')}>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </label>
            <label>Repeat
              <select disabled={isSubmitting} value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>
                <option value="none">No repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
            </label>
          </div>

          {isEdit && isRecurring && (
            <div className="rblock-editor-scope">
              <label><input disabled={isSubmitting} type="radio" name="rb-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All occurrences</label>
              <label><input disabled={isSubmitting} type="radio" name="rb-scope" checked={scope === 'today'} onChange={() => setScope('today')} /> Just today</label>
            </div>
          )}

          <div className={'rblock-editor-note' + (error ? ' is-error' : '')}>
            {error || (!isEdit && !createSaveEnabled ? 'Add a label to enable Save.' : '\u00A0')}
          </div>

          <div className="rblock-editor-actions">
            <button type="submit" className="rblock-editor-save" disabled={isSubmitting || !createSaveEnabled}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
            {isEdit
              ? <button type="button" className="rblock-editor-del" disabled={isSubmitting} onClick={() => void remove()}>Delete</button>
              : <button type="button" className="rblock-editor-cancel" disabled={isSubmitting} onClick={onClose}>Cancel</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
