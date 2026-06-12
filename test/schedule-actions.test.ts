import test from 'node:test';
import assert from 'node:assert/strict';
import type { DayData } from '../src/types';

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
