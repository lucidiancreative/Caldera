import type { Budget } from '../../../types';
import { computeBudgetSummary } from '../../store/moneySelectors';
import { formatMoney } from '../../util/format';
import { SUMMARY_CARD_ID } from './budgetKinds';
import { useCardHeight } from './useCardHeight';

// The computed cross-section figures (Net Total, Net Monthly Surplus, …) — never edited
// directly, always derived from the sections above.
export function BudgetSummary({ budget, onMeasure }: { budget: Budget; onMeasure?: (id: string, height: number) => void }) {
  const summary = computeBudgetSummary(budget);
  const rootRef = useCardHeight(SUMMARY_CARD_ID, onMeasure);
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: 'Total Income', value: summary.totalIncome },
    { label: 'Total Assets', value: summary.totalAssets },
    { label: 'Total Liabilities', value: summary.totalLiabilities },
    { label: 'Net Total', value: summary.netTotal, strong: true },
    { label: 'Total Bills', value: summary.totalBills },
    { label: 'Total Other Expenses', value: summary.totalOtherExpenses },
    { label: 'Total Monthly Expenses', value: summary.totalMonthlyExpenses, strong: true },
    { label: 'Net Monthly Surplus', value: summary.netMonthlySurplus, strong: true },
    { label: 'Goals Total', value: summary.goalsTotal },
  ];

  return (
    <section ref={rootRef} className="budget-section budget-summary">
      <header className="budget-section-head">
        <span className="budget-drag-grip" title="Drag to move" aria-hidden="true">&#10303;</span>
        <div className="budget-section-title budget-summary-heading">Summary</div>
      </header>
      <div className="budget-section-body">
        {rows.map((row) => (
          <div key={row.label} className={'budget-summary-row' + (row.strong ? ' strong' : '')}>
            <span className="budget-summary-label">{row.label}</span>
            <span className={'budget-summary-value' + (row.value < 0 ? ' negative' : '')}>{formatMoney(row.value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
