import { useState } from 'react';

// A click-to-edit cell for the budget grid: reads as plain text (like the spreadsheet) and
// turns into an input only while focused. Mirrors the TabBar inline-rename pattern —
// autoFocus, commit on blur/Enter, cancel on Escape — so the whole grid edits like Excel.
export function EditableCell({
  display,
  edit,
  placeholder,
  numeric,
  align,
  onCommit,
}: {
  display: string;
  /** Raw text seeded into the input when editing starts (defaults to `display`). */
  edit?: string;
  placeholder?: string;
  numeric?: boolean;
  align?: 'right';
  onCommit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (editing) {
    return (
      <input
        className={'budget-cell-input' + (align === 'right' ? ' right' : '')}
        autoFocus
        value={draft}
        inputMode={numeric ? 'decimal' : undefined}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { setEditing(false); onCommit(draft); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { setEditing(false); onCommit(draft); }
          else if (event.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={'budget-cell' + (align === 'right' ? ' right' : '') + (display ? '' : ' empty')}
      onClick={() => { setDraft(edit ?? display); setEditing(true); }}
    >
      {display || placeholder || ''}
    </button>
  );
}
