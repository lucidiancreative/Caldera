import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalData, DayData } from '../src/types';

// The inbox actions mutate calData directly and persist through the bridge, snapshotting
// first for undo/redo. These tests stub window.calderaBridge so we can assert the
// mutation, the snapshot, and the save all happen.
type RuntimeWindow = typeof globalThis & {
  calderaBridge?: {
    getData(): CalData;
    save(): Promise<void>;
    subscribe(listener: () => void): () => void;
    notify(): void;
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

function withStubbedBridge(calData: CalData) {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const original = runtime.window;
  const counts = { snapshots: 0, saves: 0 };
  runtime.window = {
    calderaBridge: {
      getData: () => calData,
      save: async () => { counts.saves += 1; },
      subscribe: () => () => {},
      notify: () => {},
      pushSnapshot: () => { counts.snapshots += 1; },
    },
  } as unknown as RuntimeWindow;
  return { counts, restore: () => { runtime.window = original; } };
}

test('addInboxTask appends a trimmed task, snapshots, and saves', async () => {
  const calData: CalData = { _recurring: [] };
  const { counts, restore } = withStubbedBridge(calData);
  try {
    const { addInboxTask } = await import('../src/react/store/inboxActions');
    await addInboxTask(calData, '  Email Sarah  ');
    assert.equal(calData._tasks?.length, 1);
    assert.equal(calData._tasks?.[0].label, 'Email Sarah');
    assert.equal(calData._tasks?.[0].completed, false);
    assert.equal(counts.snapshots, 1);
    assert.equal(counts.saves, 1);
  } finally {
    restore();
  }
});

test('addInboxTask ignores blank input without snapshotting or saving', async () => {
  const calData: CalData = { _recurring: [] };
  const { counts, restore } = withStubbedBridge(calData);
  try {
    const { addInboxTask } = await import('../src/react/store/inboxActions');
    await addInboxTask(calData, '   ');
    assert.equal(calData._tasks, undefined);
    assert.equal(counts.snapshots, 0);
    assert.equal(counts.saves, 0);
  } finally {
    restore();
  }
});

test('toggleInboxTask flips completed and deleteInboxTask removes by id', async () => {
  const calData: CalData = { _recurring: [], _tasks: [{ id: 't1', label: 'Draft proposal', completed: false }] };
  const { restore } = withStubbedBridge(calData);
  try {
    const { toggleInboxTask, deleteInboxTask } = await import('../src/react/store/inboxActions');
    await toggleInboxTask(calData, 't1');
    assert.equal(calData._tasks?.[0].completed, true);
    await deleteInboxTask(calData, 't1');
    assert.equal(calData._tasks?.length, 0);
  } finally {
    restore();
  }
});

test('scheduleInboxTask creates a block from the task, returns its id, and clears the task', async () => {
  const runtime = globalThis as typeof globalThis & { window?: RuntimeWindow };
  const original = runtime.window;
  const calData: CalData = {
    _recurring: [],
    _tasks: [{ id: 't1', label: 'Draft proposal', completed: false }],
    '2026-06-19': { events: [], featuredId: null, timeBlocks: [] },
  };
  const createCalls: Array<{ key: string; block: { startMin: number; endMin: number; label: string }; ampm: string }> = [];

  runtime.window = {
    calderaBridge: {
      getData: () => calData,
      save: async () => {},
      subscribe: () => () => {},
      notify: () => {},
      pushSnapshot: () => {},
    },
    calderaSchedule: {
      createBlock: async (
        key: string,
        block: { startMin: number; endMin: number; label: string },
        _recurrence: string,
        ampm: 'AM' | 'PM',
      ) => {
        createCalls.push({ key, block, ampm });
        (calData[key] as DayData).timeBlocks.push({
          id: 'new-block', startMin: block.startMin, endMin: block.endMin, label: block.label,
          color: '#000000', ampm, completed: false, subtasks: [],
        });
      },
      updateBlock: async () => {},
      deleteBlock: async () => {},
    },
  } as unknown as RuntimeWindow;

  try {
    const { scheduleInboxTask } = await import('../src/react/store/inboxActions');
    const blockId = await scheduleInboxTask(calData, 't1', '2026-06-19', 540, 600, 'AM');
    assert.equal(blockId, 'new-block');
    assert.equal(createCalls.length, 1);
    assert.deepEqual(createCalls[0].block, { startMin: 540, endMin: 600, label: 'Draft proposal' });
    assert.equal(createCalls[0].ampm, 'AM');
    assert.equal((calData['2026-06-19'] as DayData).timeBlocks.length, 1);
    assert.equal(calData._tasks?.length, 0);
  } finally {
    runtime.window = original;
  }
});
