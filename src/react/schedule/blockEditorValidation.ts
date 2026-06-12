export function canSaveBlockEditorDraft(mode: 'create' | 'edit', label: string): boolean {
  return mode === 'edit' || label.trim().length > 0;
}
