import test from 'node:test';
import assert from 'node:assert/strict';

import { canSaveBlockEditorDraft } from '../src/react/schedule/blockEditorValidation';

test('should require a non-empty label before saving a newly created block', () => {
  assert.equal(canSaveBlockEditorDraft('create', ''), false);
  assert.equal(canSaveBlockEditorDraft('create', '   '), false);
  assert.equal(canSaveBlockEditorDraft('create', 'Lunch'), true);
});

test('should still allow save on edit mode so blank labels can follow the existing delete-on-save flow', () => {
  assert.equal(canSaveBlockEditorDraft('edit', ''), true);
  assert.equal(canSaveBlockEditorDraft('edit', 'Updated title'), true);
});
