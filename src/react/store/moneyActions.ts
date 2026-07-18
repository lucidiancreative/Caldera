// Write actions for the Money lens's budgets. Like the inbox actions, these mutate the
// shared calData directly and persist through the bridge, snapshotting first for undo/redo.
// Three layers: budget → section → item. Each validates first, then snapshots + mutates +
// saves, so no-ops never clutter the undo history.
import type { Budget, BudgetItem, BudgetSection, BudgetSectionKind, CalData, SectionLayout } from '../../types';
import { saveCalData } from './calStore';
import { BUDGET_KINDS, SUMMARY_CARD_ID } from '../lens/money/budgetKinds';
import { makeDefaultBudget, makeEmptyBudget } from '../lens/money/defaultBudget';

type BridgeWindow = typeof globalThis & { calderaBridge?: { pushSnapshot(): void } };
declare const window: BridgeWindow;

function newId(): string {
  return 'bud' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function snapshot(): void {
  window.calderaBridge?.pushSnapshot();
}

function budgetsOf(calData: CalData): Budget[] {
  if (!Array.isArray(calData._budgets)) calData._budgets = [];
  return calData._budgets;
}

function findBudget(calData: CalData, budgetId: string): Budget | undefined {
  return budgetsOf(calData).find((budget) => budget.id === budgetId);
}

function findSection(calData: CalData, budgetId: string, sectionId: string): BudgetSection | undefined {
  return findBudget(calData, budgetId)?.sections.find((section) => section.id === sectionId);
}

function findItem(items: BudgetItem[], id: string): BudgetItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItem(item.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function removeItem(items: BudgetItem[], id: string): boolean {
  const index = items.findIndex((item) => item.id === id);
  if (index !== -1) {
    items.splice(index, 1);
    return true;
  }
  return items.some((item) => item.children && removeItem(item.children, id));
}

// ── Budgets ──────────────────────────────────────────────────────────────────

/** Seed the project's first budget from the spreadsheet template if it has none. Idempotent. */
export async function ensureBudget(calData: CalData): Promise<string> {
  const budgets = budgetsOf(calData);
  if (budgets.length) return budgets[0].id;
  snapshot();
  const budget = makeDefaultBudget();
  budgets.push(budget);
  await saveCalData();
  return budget.id;
}

/** Add a new, empty budget (all sections, no rows). Returns its id so the caller can select it. */
export async function addBudget(calData: CalData, name?: string): Promise<string> {
  const budgets = budgetsOf(calData);
  snapshot();
  const budget = makeEmptyBudget((name || '').trim() || `Budget ${budgets.length + 1}`);
  budgets.push(budget);
  await saveCalData();
  return budget.id;
}

export async function renameBudget(calData: CalData, budgetId: string, name: string): Promise<void> {
  const budget = findBudget(calData, budgetId);
  const trimmed = name.trim();
  if (!budget || !trimmed) return;
  snapshot();
  budget.name = trimmed;
  await saveCalData();
}

export async function deleteBudget(calData: CalData, budgetId: string): Promise<void> {
  const budgets = budgetsOf(calData);
  const index = budgets.findIndex((budget) => budget.id === budgetId);
  if (index === -1) return;
  snapshot();
  budgets.splice(index, 1);
  await saveCalData();
}

// ── Sections ─────────────────────────────────────────────────────────────────

export async function addSection(calData: CalData, budgetId: string, kind: BudgetSectionKind, layout?: SectionLayout): Promise<void> {
  const budget = findBudget(calData, budgetId);
  if (!budget) return;
  snapshot();
  const section: BudgetSection = { id: newId(), kind, title: BUDGET_KINDS[kind].defaultTitle, items: [] };
  if (layout) section.layout = layout;
  budget.sections.push(section);
  await saveCalData();
}

function cloneItems(items: BudgetItem[]): BudgetItem[] {
  return items.map((item) => {
    const copy: BudgetItem = { id: newId(), label: item.label, values: { ...item.values } };
    if (item.date) copy.date = item.date;
    if (item.children) copy.children = cloneItems(item.children);
    return copy;
  });
}

/** Deep-clone a section (fresh ids throughout), offset one grid cell so it doesn't hide the original. */
export async function duplicateSection(calData: CalData, budgetId: string, sectionId: string): Promise<void> {
  const budget = findBudget(calData, budgetId);
  const original = budget?.sections.find((section) => section.id === sectionId);
  if (!budget || !original) return;
  snapshot();
  const copy: BudgetSection = {
    id: newId(),
    kind: original.kind,
    title: `${original.title} copy`,
    items: cloneItems(original.items),
    collapsed: original.collapsed,
  };
  if (original.layout) copy.layout = { x: original.layout.x + 1, y: original.layout.y + 1, w: original.layout.w };
  budget.sections.push(copy);
  await saveCalData();
}

/** Persist card positions after a drag. Saves without a snapshot (like collapse) so dragging
 *  never floods undo, and only when something actually moved (RGL fires on mount too). */
export async function setSectionsLayout(
  calData: CalData,
  budgetId: string,
  layouts: { id: string; x: number; y: number; w: number }[],
): Promise<void> {
  const budget = findBudget(calData, budgetId);
  if (!budget) return;
  let changed = false;
  const apply = (current: SectionLayout | undefined, next: { x: number; y: number; w: number }): SectionLayout | undefined => {
    if (current && current.x === next.x && current.y === next.y && current.w === next.w) return current;
    changed = true;
    return { x: next.x, y: next.y, w: next.w };
  };
  for (const entry of layouts) {
    if (entry.id === SUMMARY_CARD_ID) {
      budget.summaryLayout = apply(budget.summaryLayout, entry);
      continue;
    }
    const section = budget.sections.find((candidate) => candidate.id === entry.id);
    if (section) section.layout = apply(section.layout, entry);
  }
  if (changed) await saveCalData();
}

export async function renameSection(calData: CalData, budgetId: string, sectionId: string, title: string): Promise<void> {
  const section = findSection(calData, budgetId, sectionId);
  const trimmed = title.trim();
  if (!section || !trimmed) return;
  snapshot();
  section.title = trimmed;
  await saveCalData();
}

export async function deleteSection(calData: CalData, budgetId: string, sectionId: string): Promise<void> {
  const budget = findBudget(calData, budgetId);
  if (!budget) return;
  const index = budget.sections.findIndex((section) => section.id === sectionId);
  if (index === -1) return;
  snapshot();
  budget.sections.splice(index, 1);
  await saveCalData();
}

/** Collapse/expand is view state, not undo-worthy, so it saves without a snapshot. */
export async function toggleSectionCollapsed(calData: CalData, budgetId: string, sectionId: string): Promise<void> {
  const section = findSection(calData, budgetId, sectionId);
  if (!section) return;
  section.collapsed = !section.collapsed;
  await saveCalData();
}

// ── Items ────────────────────────────────────────────────────────────────────

/** Add a row to a section (parentItemId = null) or as a child of an existing row. */
export async function addItem(
  calData: CalData,
  budgetId: string,
  sectionId: string,
  parentItemId: string | null,
  label = 'New item',
): Promise<string | null> {
  const section = findSection(calData, budgetId, sectionId);
  if (!section) return null;
  const item: BudgetItem = { id: newId(), label, values: {} };
  if (parentItemId) {
    const parent = findItem(section.items, parentItemId);
    if (!parent) return null;
    (parent.children ??= []).push(item);
  } else {
    section.items.push(item);
  }
  snapshot();
  await saveCalData();
  return item.id;
}

export async function updateItemLabel(calData: CalData, budgetId: string, sectionId: string, itemId: string, label: string): Promise<void> {
  const section = findSection(calData, budgetId, sectionId);
  const item = section && findItem(section.items, itemId);
  const trimmed = label.trim();
  if (!item || !trimmed || item.label === trimmed) return;
  snapshot();
  item.label = trimmed;
  await saveCalData();
}

/** Set a numeric cell; `null`/NaN clears it so the value stops counting toward totals. */
export async function setItemValue(
  calData: CalData,
  budgetId: string,
  sectionId: string,
  itemId: string,
  colId: string,
  value: number | null,
): Promise<void> {
  const section = findSection(calData, budgetId, sectionId);
  const item = section && findItem(section.items, itemId);
  if (!item) return;
  snapshot();
  if (value === null || Number.isNaN(value)) delete item.values[colId];
  else item.values[colId] = value;
  await saveCalData();
}

export async function setItemDate(calData: CalData, budgetId: string, sectionId: string, itemId: string, date: string): Promise<void> {
  const section = findSection(calData, budgetId, sectionId);
  const item = section && findItem(section.items, itemId);
  if (!item) return;
  const trimmed = date.trim();
  snapshot();
  if (trimmed) item.date = trimmed;
  else delete item.date;
  await saveCalData();
}

export async function deleteItem(calData: CalData, budgetId: string, sectionId: string, itemId: string): Promise<void> {
  const section = findSection(calData, budgetId, sectionId);
  if (!section || !findItem(section.items, itemId)) return;
  snapshot();
  removeItem(section.items, itemId);
  await saveCalData();
}
