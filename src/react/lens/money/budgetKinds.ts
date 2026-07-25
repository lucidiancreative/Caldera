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
  /** Default header-stripe colour; a section's own `color` overrides it. */
  accent: string;
}

export const BUDGET_KINDS: Record<BudgetSectionKind, BudgetKindDef> = {
  income: { kind: 'income', defaultTitle: 'Income', columns: [{ id: 'amount', label: '/ Month' }], accent: '#3fa46a' },
  assets: {
    kind: 'assets',
    defaultTitle: 'Assets',
    columns: [{ id: 'allocation', label: 'Monthly Allocation' }, { id: 'total', label: 'Total' }],
    accent: '#3fa46a',
  },
  liabilities: { kind: 'liabilities', defaultTitle: 'Liabilities', columns: [{ id: 'total', label: 'Total' }], accent: '#e0524d' },
  bills: {
    kind: 'bills',
    defaultTitle: 'Bills',
    columns: [{ id: 'monthly', label: '$ / Month' }, { id: 'check1', label: 'Check 1' }, { id: 'check2', label: 'Check 2' }],
    accent: '#e08a3c',
  },
  funds: { kind: 'funds', defaultTitle: 'Other Expenses', columns: [{ id: 'amount', label: 'Amount' }], accent: '#7a6cf0' },
  goals: { kind: 'goals', defaultTitle: 'Goals', columns: [{ id: 'goal', label: 'Goal' }], hasDate: true, accent: '#3c7ae0' },
  // A blank, user-added panel: single Amount column, neutral stripe, fully customizable.
  custom: { kind: 'custom', defaultTitle: 'New panel', columns: [{ id: 'amount', label: 'Amount' }], accent: '#8e8e93' },
};

// The default budget's section skeleton (makeEmptyBudget) follows this; the "Add panel"
// menu no longer uses it — it always adds a `custom` panel.
export const BUDGET_KIND_ORDER: BudgetSectionKind[] = ['income', 'assets', 'liabilities', 'bills', 'funds', 'goals'];

// The preset swatches offered when recolouring a panel's header stripe.
export const BUDGET_ACCENT_PRESETS = ['#3fa46a', '#3c7ae0', '#e08a3c', '#e0524d', '#7a6cf0', '#d94f9c', '#4aa8a0', '#8e8e93'];

// Semantic colour tone for totals (rendered via .budget-tone-* CSS classes):
// positive = money in / worth, negative = owed, expense = money out, goals = savings targets.
export type MoneyTone = 'positive' | 'negative' | 'expense' | 'goals';

/** The tone a section's Total row uses. `custom` panels have no inferable meaning → neutral. */
export function sectionTotalTone(kind: BudgetSectionKind): MoneyTone | null {
  switch (kind) {
    case 'income':
    case 'assets':
      return 'positive';
    case 'liabilities':
      return 'negative';
    case 'bills':
    case 'funds':
      return 'expense';
    case 'goals':
      return 'goals';
    default:
      return null;
  }
}

// Reserved layout id for the computed Summary card on the dashboard canvas (it isn't a
// real section, but it's placed/persisted like one via Budget.summaryLayout).
export const SUMMARY_CARD_ID = '__summary__';
