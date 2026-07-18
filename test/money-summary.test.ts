import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultBudget, makeEmptyBudget } from '../src/react/lens/money/defaultBudget';
import { computeBudgetSummary, sectionColumnTotals, sumColumn } from '../src/react/store/moneySelectors';

// The default budget re-creates the user's spreadsheet; these lock its published totals so a
// future edit to the seed or the rollup math can't silently drift the numbers.
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`);

test('default budget summary matches the source spreadsheet figures', () => {
  const summary = computeBudgetSummary(makeDefaultBudget());
  assert.equal(summary.totalIncome, 4100);
  close(summary.totalAssets, 11273.91);
  assert.equal(summary.totalLiabilities, 5431);
  close(summary.netTotal, 5842.91);
  assert.equal(summary.totalBills, 1442);
  assert.equal(summary.totalOtherExpenses, 550);
  assert.equal(summary.totalMonthlyExpenses, 1992);
  assert.equal(summary.netMonthlySurplus, 2108);
  assert.equal(summary.goalsTotal, 49131);
});

test('sectionColumnTotals sums every column independently (Bills = 1442 / 748 / 748)', () => {
  const bills = makeDefaultBudget().sections.find((section) => section.kind === 'bills');
  assert.ok(bills);
  // The per-paycheck columns are their own numbers, not half the monthly — only the
  // monthly column reconciles to the summary's Total Monthly Expenses.
  const totals = sectionColumnTotals(bills!);
  assert.equal(totals.monthly, 1442);
  assert.equal(totals.check1, 748);
  assert.equal(totals.check2, 748);
});

test('sumColumn counts nested children and ignores header rows without values', () => {
  const funds = makeDefaultBudget().sections.find((section) => section.kind === 'funds');
  assert.ok(funds);
  // Dinners 120 + Activities 80 + Clothing 50 + Teeth 200 + Truck 100 = 550, across 3 nesting levels.
  assert.equal(sumColumn(funds!.items, 'amount'), 550);
});

test('an empty budget has every section but zero totals', () => {
  const summary = computeBudgetSummary(makeEmptyBudget('Business'));
  assert.equal(summary.totalIncome, 0);
  assert.equal(summary.netTotal, 0);
  assert.equal(summary.goalsTotal, 0);
  assert.equal(makeEmptyBudget('Business').sections.length, 6);
});
