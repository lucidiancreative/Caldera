import { useEffect } from 'react';

// Themed in-app replacement for window.confirm so destructive actions match the app's
// skin/theme. Mirrors the .rblock-editor modal treatment (blurred overlay + color-mix
// surface) so it reads consistently across light/dark and every skin.
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="confirm-dialog" role="dialog" aria-modal="true">
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          {/* Focus the safe option by default so a stray Enter/Escape never deletes. */}
          <button className="confirm-cancel" autoFocus onClick={onCancel}>{cancelLabel}</button>
          <button className={'confirm-ok' + (destructive ? ' destructive' : '')} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
