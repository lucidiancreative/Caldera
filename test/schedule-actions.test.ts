import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalData, DayData } from '../src/types';

type RuntimeWindow = typeof globalThis & {
  calderaBridge?: {
    subscribe(listener: () => void): () => void;
    getData(): Record<string, unknown>;
    notify(): void;
    save(): Promise<void>;
    pushSnapshot(): void;
  };
  calderaSchedule?: {
    createBlock(
      key: string,
      block: { startMin: number; endMin: number; label: string },
      recurrence: string,
      ampm: 'AM' | 'PM',
    ): Promise<void>;
    updateBlock(): Promise<void>;
    deleteBlock(): Promise<void>;
  };
};

test('should dedupe concurrent identical React createBlock requests', async () => {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const originalWindow = runtime.window;
  const createCalls: Array<{
    key: string;
    block: { startMin: number; endMin: number; label: string };
    recurrence: string;
    ampm: 'AM' | 'PM';
  }> = [];
  const data = { _recurring: [] as never[] };

  let resolveCreate: (() => void) | null = null;
  const createPromise = new Promise<void>((resolve) => {
    resolveCreate = resolve;
  });

  runtime.window = {
    calderaBridge: {
      subscribe: () => () => {},
      getData: () => data,
      notify: () => {},
      save: async () => {},
      pushSnapshot: () => {},
    },
    calderaSchedule: {
      createBlock: async (
        key: string,
        block: { startMin: number; endMin: number; label: string },
        recurrence: string,
        ampm: 'AM' | 'PM',
      ) => {
        createCalls.push({ key, block, recurrence, ampm });
        await createPromise;
      },
      updateBlock: async () => {},
      deleteBlock: async () => {},
    },
  } as unknown as RuntimeWindow;

  try {
    const { createBlock } = await import('../src/react/store/actions');
    const payload = { startMin: 30, endMin: 255, label: 'Weekly debug block' };

    const first = createBlock('2026-06-11', payload, 'none', 'AM');
    const second = createBlock('2026-06-11', payload, 'none', 'AM');

    assert.equal(first, second);
    assert.equal(createCalls.length, 1);

    if (!resolveCreate) throw new Error('create promise resolver was not initialized');
    (resolveCreate as () => void)();
    await Promise.all([first, second]);
    assert.equal(createCalls.length, 1);
  } finally {
    runtime.window = originalWindow;
  }
});

test('should restore the previous calendar data when the React createBlock bridge call fails', async () => {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const originalWindow = runtime.window;
  const data: { _recurring: never[]; '2026-06-11': DayData } = {
    _recurring: [] as never[],
    '2026-06-11': {
      events: [],
      featuredId: null,
      timeBlocks: [],
    },
  };
  let notifyCount = 0;

  runtime.window = {
    calderaBridge: {
      subscribe: () => () => {},
      getData: () => data,
      notify: () => { notifyCount += 1; },
      save: async () => {},
      pushSnapshot: () => {},
    },
    calderaSchedule: {
      createBlock: async (
        _key: string,
        block: { startMin: number; endMin: number; label: string },
      ) => {
        data['2026-06-11'].timeBlocks.push({
          id: 'temp-block',
          startMin: block.startMin,
          endMin: block.endMin,
          label: block.label,
          color: '#000000',
          ampm: 'AM',
          completed: false,
          subtasks: [],
        });
        throw new Error('disk write failed');
      },
      updateBlock: async () => {},
      deleteBlock: async () => {},
    },
  } as unknown as RuntimeWindow;

  try {
    const { createBlock } = await import('../src/react/store/actions');
    await assert.rejects(
      () => createBlock('2026-06-11', { startMin: 30, endMin: 255, label: 'Rollback me' }, 'none', 'AM'),
      /disk write failed/,
    );

    assert.deepEqual(data, {
      _recurring: [],
      '2026-06-11': {
        events: [],
        featuredId: null,
        timeBlocks: [],
      },
    });
    assert.equal(notifyCount, 1);
  } finally {
    runtime.window = originalWindow;
  }
});

test('moveBlockToDate relocates a one-off block to another day with new times, snapshotting and saving once', async () => {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const originalWindow = runtime.window;
  const calData: CalData = {
    _recurring: [],
    '2026-06-19': {
      events: [],
      featuredId: null,
      timeBlocks: [{
        id: 'b1', startMin: 60, endMin: 120, label: 'Standup',
        color: '#000', ampm: 'AM', completed: false, subtasks: [],
      }],
    },
  };
  const counts = { snapshots: 0, saves: 0 };

  runtime.window = {
    calderaBridge: {
      subscribe: () => () => {},
      getData: () => calData as unknown as Record<string, unknown>,
      notify: () => {},
      save: async () => { counts.saves += 1; },
      pushSnapshot: () => { counts.snapshots += 1; },
    },
  } as unknown as RuntimeWindow;

  try {
    const { moveBlockToDate } = await import('../src/react/store/actions');
    await moveBlockToDate(calData, '2026-06-19', 'b1', '2026-06-21', { startMin: 30, endMin: 90, ampm: 'PM' });

    // Source day had only this block, so it is pruned entirely.
    assert.equal(calData['2026-06-19'], undefined);
    const moved = (calData['2026-06-21'] as DayData).timeBlocks;
    assert.equal(moved.length, 1);
    assert.deepEqual(
      { id: moved[0].id, startMin: moved[0].startMin, endMin: moved[0].endMin, ampm: moved[0].ampm },
      { id: 'b1', startMin: 30, endMin: 90, ampm: 'PM' },
    );
    assert.equal(counts.snapshots, 1);
    assert.equal(counts.saves, 1);
  } finally {
    runtime.window = originalWindow;
  }
});

test('moveBlockToDate is a no-op when the destination equals the source day', async () => {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const originalWindow = runtime.window;
  const calData: CalData = {
    _recurring: [],
    '2026-06-19': {
      events: [],
      featuredId: null,
      timeBlocks: [{
        id: 'b1', startMin: 60, endMin: 120, label: 'Standup',
        color: '#000', ampm: 'AM', completed: false, subtasks: [],
      }],
    },
  };
  const counts = { snapshots: 0, saves: 0 };

  runtime.window = {
    calderaBridge: {
      subscribe: () => () => {},
      getData: () => calData as unknown as Record<string, unknown>,
      notify: () => {},
      save: async () => { counts.saves += 1; },
      pushSnapshot: () => { counts.snapshots += 1; },
    },
  } as unknown as RuntimeWindow;

  try {
    const { moveBlockToDate } = await import('../src/react/store/actions');
    await moveBlockToDate(calData, '2026-06-19', 'b1', '2026-06-19', { startMin: 30, endMin: 90, ampm: 'PM' });

    const block = (calData['2026-06-19'] as DayData).timeBlocks[0];
    assert.deepEqual(
      { startMin: block.startMin, endMin: block.endMin, ampm: block.ampm },
      { startMin: 60, endMin: 120, ampm: 'AM' },
    );
    assert.equal(counts.snapshots, 0);
    assert.equal(counts.saves, 0);
  } finally {
    runtime.window = originalWindow;
  }
});

test('updateSubtaskNotes saves changed notes with one snapshot', async () => {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const originalWindow = runtime.window;
  const calData: CalData = {
    _recurring: [],
    '2026-06-19': {
      events: [],
      featuredId: null,
      timeBlocks: [{
        id: 'b1', startMin: 60, endMin: 120, label: 'Standup',
        color: '#000', ampm: 'AM', completed: false,
        subtasks: [{ id: 's1', label: 'Prep', completed: false, notes: '' }],
      }],
    },
  };
  const counts = { snapshots: 0, saves: 0 };

  runtime.window = {
    calderaBridge: {
      subscribe: () => () => {},
      getData: () => calData as unknown as Record<string, unknown>,
      notify: () => {},
      save: async () => { counts.saves += 1; },
      pushSnapshot: () => { counts.snapshots += 1; },
    },
  } as unknown as RuntimeWindow;

  try {
    const { updateSubtaskNotes } = await import('../src/react/store/actions');
    await updateSubtaskNotes('2026-06-19', 'b1', 's1', '  Bring agenda  ');

    const task = (calData['2026-06-19'] as DayData).timeBlocks[0].subtasks[0];
    assert.equal(task.notes, 'Bring agenda');
    assert.equal(counts.snapshots, 1);
    assert.equal(counts.saves, 1);

    await updateSubtaskNotes('2026-06-19', 'b1', 's1', 'Bring agenda');
    assert.equal(counts.snapshots, 1);
    assert.equal(counts.saves, 1);
  } finally {
    runtime.window = originalWindow;
  }
});
