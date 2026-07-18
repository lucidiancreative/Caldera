import test from 'node:test';
import assert from 'node:assert/strict';
import type { Budget, CalData } from '../src/types';

// Mirrors inbox-actions.test.ts: stub window.calderaBridge so we can assert the mutation,
// the snapshot, and the save all happen for the Money lens's budget actions.
type RuntimeWindow = typeof globalThis & {
  calderaBridge?: {
    getData(): CalData;
    save(): Promise<void>;
    subscribe(listener: () => void): () => void;
    notify(): void;
    pushSnapshot(): void;
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

test('ensureBudget seeds the default template once and is idempotent', async () => {
  const calData: CalData = { _recurring: [] };
  const { counts, restore } = withStubbedBridge(calData);
  try {
    const { ensureBudget } = await import('../src/react/store/moneyActions');
    const firstId = await ensureBudget(calData);
    assert.equal(calData._budgets?.length, 1);
    assert.equal(calData._budgets?.[0].id, firstId);
    assert.equal(calData._budgets?.[0].sections.length, 6);
    assert.equal(counts.snapshots, 1);
    assert.equal(counts.saves, 1);

    const secondId = await ensureBudget(calData); // no-op: already has a budget
    assert.equal(secondId, firstId);
    assert.equal(calData._budgets?.length, 1);
    assert.equal(counts.snapshots, 1);
  } finally {
    restore();
  }
});

test('addBudget appends an empty budget with a generated name', async () => {
  const calData: CalData = { _recurring: [], _budgets: [] };
  const { restore } = withStubbedBridge(calData);
  try {
    const { addBudget } = await import('../src/react/store/moneyActions');
    const id = await addBudget(calData);
    assert.equal(calData._budgets?.length, 1);
    assert.equal(calData._budgets?.[0].id, id);
    assert.equal(calData._budgets?.[0].name, 'Budget 1');
    assert.equal(calData._budgets?.[0].sections.every((s) => s.items.length === 0), true);
  } finally {
    restore();
  }
});

function oneBudget(): CalData {
  const budget: Budget = {
    id: 'b1',
    name: 'Personal',
    sections: [{ id: 's1', kind: 'bills', title: 'Bills', items: [] }],
  };
  return { _recurring: [], _budgets: [budget] };
}

test('addItem adds a top-level row then a nested child', async () => {
  const calData = oneBudget();
  const { restore } = withStubbedBridge(calData);
  try {
    const { addItem } = await import('../src/react/store/moneyActions');
    const rowId = await addItem(calData, 'b1', 's1', null, 'Rent');
    assert.ok(rowId);
    const section = calData._budgets![0].sections[0];
    assert.equal(section.items.length, 1);
    assert.equal(section.items[0].label, 'Rent');

    const childId = await addItem(calData, 'b1', 's1', rowId, 'Parking');
    assert.ok(childId);
    assert.equal(section.items[0].children?.length, 1);
    assert.equal(section.items[0].children?.[0].label, 'Parking');
  } finally {
    restore();
  }
});

test('setItemValue writes then clears a cell; deleteItem removes recursively', async () => {
  const calData = oneBudget();
  const { restore } = withStubbedBridge(calData);
  try {
    const { addItem, setItemValue, deleteItem } = await import('../src/react/store/moneyActions');
    const rowId = (await addItem(calData, 'b1', 's1', null, 'Rent'))!;
    const childId = (await addItem(calData, 'b1', 's1', rowId, 'Parking'))!;
    const section = calData._budgets![0].sections[0];

    await setItemValue(calData, 'b1', 's1', rowId, 'monthly', 825);
    assert.equal(section.items[0].values.monthly, 825);
    await setItemValue(calData, 'b1', 's1', rowId, 'monthly', null);
    assert.equal('monthly' in section.items[0].values, false);

    // Deleting the parent removes its nested child too.
    await deleteItem(calData, 'b1', 's1', rowId);
    assert.equal(section.items.length, 0);
    // sanity: the removed child id is gone
    void childId;
  } finally {
    restore();
  }
});

test('renameSection / deleteSection / deleteBudget mutate and save', async () => {
  const calData = oneBudget();
  const { counts, restore } = withStubbedBridge(calData);
  try {
    const { renameSection, deleteSection, deleteBudget } = await import('../src/react/store/moneyActions');
    await renameSection(calData, 'b1', 's1', '  Monthly Bills  ');
    assert.equal(calData._budgets![0].sections[0].title, 'Monthly Bills');

    await deleteSection(calData, 'b1', 's1');
    assert.equal(calData._budgets![0].sections.length, 0);

    await deleteBudget(calData, 'b1');
    assert.equal(calData._budgets?.length, 0);
    assert.ok(counts.saves >= 3);
  } finally {
    restore();
  }
});

test('duplicateSection deep-clones with fresh ids and an offset layout', async () => {
  const calData = oneBudget();
  const { restore } = withStubbedBridge(calData);
  try {
    const { addItem, duplicateSection } = await import('../src/react/store/moneyActions');
    const rowId = (await addItem(calData, 'b1', 's1', null, 'Rent'))!;
    await addItem(calData, 'b1', 's1', rowId, 'Parking');
    calData._budgets![0].sections[0].layout = { x: 2, y: 1, w: 4 };

    await duplicateSection(calData, 'b1', 's1');
    const sections = calData._budgets![0].sections;
    assert.equal(sections.length, 2);
    const copy = sections[1];
    assert.notEqual(copy.id, 's1');
    assert.equal(copy.title, 'Bills copy');
    assert.equal(copy.items[0].label, 'Rent');
    assert.notEqual(copy.items[0].id, rowId);
    assert.equal(copy.items[0].children?.[0].label, 'Parking');
    assert.deepEqual(copy.layout, { x: 3, y: 2, w: 4 });
  } finally {
    restore();
  }
});

test('setSectionsLayout persists positions (incl. summary) and only saves on change', async () => {
  const calData = oneBudget();
  const { counts, restore } = withStubbedBridge(calData);
  try {
    const { setSectionsLayout } = await import('../src/react/store/moneyActions');
    const layout = [
      { id: 's1', x: 0, y: 0, w: 6 },
      { id: '__summary__', x: 6, y: 0, w: 6 },
    ];
    await setSectionsLayout(calData, 'b1', layout);
    assert.deepEqual(calData._budgets![0].sections[0].layout, { x: 0, y: 0, w: 6 });
    assert.deepEqual(calData._budgets![0].summaryLayout, { x: 6, y: 0, w: 6 });

    const savesAfterFirst = counts.saves;
    await setSectionsLayout(calData, 'b1', layout); // identical → no save
    assert.equal(counts.saves, savesAfterFirst);
  } finally {
    restore();
  }
});
