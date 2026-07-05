// Create/edit a schedule block. Mirrors the vanilla block popup's fields (label,
// AM/PM, recurrence, and an all/today scope for recurring edits) but as a centered
// React modal. Writes go through the schedule bridge. An empty label deletes (edit)
// or cancels (create), matching the vanilla behavior.
import { useEffect, useRef, useState } from 'react';
import type { ScheduleBlock } from '../store/selectors';
import { createBlock, updateBlock, deleteBlock } from '../store/actions';
import { createBlockFromTask } from '../store/inboxActions';
import { formatBlockTimeRange } from '../util/format';
import { canSaveBlockEditorDraft } from './blockEditorValidation';
import { absMinutesToClockInput, absoluteMinutesToBlockTimes, clockInputToAbsMinutes, getAbsoluteMinutes } from './timeline';

// `label`/`sourceTaskId` are set when the create was seeded from an inbox task drop: the label
// pre-fills the field, and sourceTaskId routes the save through createBlockFromTask so the task
// is consumed in the same undo step as the new block.
export type EditorTarget =
  | { mode: 'edit'; date: string; block: ScheduleBlock }
  | { mode: 'create'; date: string; startMin: number; endMin: number; ampm: 'AM' | 'PM'; label?: string; sourceTaskId?: string };

interface BlockEditorProps {
  target: EditorTarget;
  onClose: () => void;
}

export function BlockEditor({ target, onClose }: BlockEditorProps) {
  const isEdit = target.mode === 'edit';
  const block = target.mode === 'edit' ? target.block : null;
  const isRecurring = !!block?.recurring;

  const [label, setLabel] = useState(target.mode === 'edit' ? target.block.label : (target.label ?? ''));
  const [recurrence, setRecurrence] = useState<string>(block?.recurring ? block.recurrence ?? 'daily' : 'none');
  const [scope, setScope] = useState<'all' | 'today'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitLockRef = useRef(false);

  // Unwrap the seed's stored 12h + AM/PM times into absolute day-minutes so the AM/PM boundary is
  // derived by absoluteMinutesToBlockTimes on save (no separate AM/PM toggle). Both modes drive an
  // explicit start + end.
  const seed = target.mode === 'edit'
    ? getAbsoluteMinutes(target.block)
    : getAbsoluteMinutes({ startMin: target.startMin, endMin: target.endMin, ampm: target.ampm });
  const [startTime, setStartTime] = useState(() => absMinutesToClockInput(seed.start));
  const [endTime, setEndTime] = useState(() => absMinutesToClockInput(seed.end));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isSubmitting) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSubmitting, onClose]);

  // Both modes resolve to the same on-disk shape ({ startMin, endMin, ampm }); the header shows it live.
  const resolvedTimes = absoluteMinutesToBlockTimes(clockInputToAbsMinutes(startTime), clockInputToAbsMinutes(endTime));
  const timeRange = formatBlockTimeRange(resolvedTimes);
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
        await updateBlock(target.date, target.block.id, trimmed, recurrence, scope, resolvedTimes.ampm, resolvedTimes.startMin, resolvedTimes.endMin);
      } else {
        const draft = { startMin: resolvedTimes.startMin, endMin: resolvedTimes.endMin, label: trimmed };
        if (target.sourceTaskId) {
          await createBlockFromTask(target.sourceTaskId, target.date, draft, recurrence, resolvedTimes.ampm);
        } else {
          await createBlock(target.date, draft, recurrence, resolvedTimes.ampm);
        }
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
            <label>Start
              <input
                type="time"
                className="rblock-editor-time-input"
                disabled={isSubmitting}
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label>End
              <input
                type="time"
                className="rblock-editor-time-input"
                disabled={isSubmitting}
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </div>

          <div className="rblock-editor-row">
            <label>Repeat
              <select disabled={isSubmitting} value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>
                <option value="none">No repeat</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="weekends">Weekends (Sat–Sun)</option>
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
