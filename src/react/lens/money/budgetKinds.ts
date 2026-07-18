import type { BudgetSectionKind } from '../../../types';

// The fixed catalogue of budget section types. Each kind declares its value columns
// (which is the one thing users can't change — see the plan's "names & structure" scope)
// and a default title. Kept dependency-free so selectors, actions, and tests can import it.
export interface BudgetColumn {
  id: string;
  label: string;
}

export interface BudgetKindDef {
  kind: BudgetSectionKind;
  defaultTitle: string;
  columns: BudgetColumn[];
  /** Goals carry a target date alongside their value column. */
  hasDate?: boolean;
}

export const BUDGET_KINDS: Record<BudgetSectionKind, BudgetKindDef> = {
  income: { kind: 'income', defaultTitle: 'Income', columns: [{ id: 'amount', label: '/ Month' }] },
  assets: {
    kind: 'assets',
    defaultTitle: 'Assets',
    columns: [{ id: 'allocation', label: 'Monthly Allocation' }, { id: 'total', label: 'Total' }],
  },
  liabilities: { kind: 'liabilities', defaultTitle: 'Liabilities', columns: [{ id: 'total', label: 'Total' }] },
  bills: {
    kind: 'bills',
    defaultTitle: 'Bills',
    columns: [{ id: 'monthly', label: '$ / Month' }, { id: 'check1', label: 'Check 1' }, { id: 'check2', label: 'Check 2' }],
  },
  funds: { kind: 'funds', defaultTitle: 'Other Expenses', columns: [{ id: 'amount', label: 'Amount' }] },
  goals: { kind: 'goals', defaultTitle: 'Goals', columns: [{ id: 'goal', label: 'Goal' }], hasDate: true },
};

// Order the "add section" menu and the default budget's sections follow.
export const BUDGET_KIND_ORDER: BudgetSectionKind[] = ['income', 'assets', 'liabilities', 'bills', 'funds', 'goals'];

// Reserved layout id for the computed Summary card on the dashboard canvas (it isn't a
// real section, but it's placed/persisted like one via Budget.summaryLayout).
export const SUMMARY_CARD_ID = '__summary__';
