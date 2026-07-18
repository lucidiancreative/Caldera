// Pure selectors over the Money lens's budgets — no DOM, no window, no React, so they can
// be unit-tested in isolation. The whole value of a budget is correct totals, so these are
// the heart of the feature and are covered by money-summary.test.ts.
import type { Budget, BudgetItem, BudgetSection, BudgetSectionKind, CalData } from '../../types';
import { BUDGET_KINDS } from '../lens/money/budgetKinds';

/** The project's budgets. Empty until the Money lens seeds a default one. */
export function getBudgets(calData: CalData): Budget[] {
  return Array.isArray(calData._budgets) ? calData._budgets : [];
}

/** Recursive sum of one column across an item tree; missing/non-finite values count as 0. */
export function sumColumn(items: BudgetItem[], colId: string): number {
  let total = 0;
  for (const item of items) {
    const value = item.values?.[colId];
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
    if (item.children?.length) total += sumColumn(item.children, colId);
  }
  return total;
}

/** Footer totals for a section — one sum per column its kind defines. */
export function sectionColumnTotals(section: BudgetSection): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const column of BUDGET_KINDS[section.kind].columns) {
    totals[column.id] = sumColumn(section.items, column.id);
  }
  return totals;
}

function sumKind(budget: Budget, kind: BudgetSectionKind, colId: string): number {
  return budget.sections
    .filter((section) => section.kind === kind)
    .reduce((acc, section) => acc + sumColumn(section.items, colId), 0);
}

export interface BudgetSummary {
  totalIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  netTotal: number;
  totalBills: number;
  totalOtherExpenses: number;
  totalMonthlyExpenses: number;
  netMonthlySurplus: number;
  goalsTotal: number;
}

/** Cross-section rollups matching the source spreadsheet's summary block. */
export function computeBudgetSummary(budget: Budget): BudgetSummary {
  const totalIncome = sumKind(budget, 'income', 'amount');
  const totalAssets = sumKind(budget, 'assets', 'total');
  const totalLiabilities = sumKind(budget, 'liabilities', 'total');
  const totalBills = sumKind(budget, 'bills', 'monthly');
  const totalOtherExpenses = sumKind(budget, 'funds', 'amount');
  const totalMonthlyExpenses = totalBills + totalOtherExpenses;
  return {
    totalIncome,
    totalAssets,
    totalLiabilities,
    netTotal: totalAssets - totalLiabilities,
    totalBills,
    totalOtherExpenses,
    totalMonthlyExpenses,
    netMonthlySurplus: totalIncome - totalMonthlyExpenses,
    goalsTotal: sumKind(budget, 'goals', 'goal'),
  };
}
