import type { Budget } from '../../../types';
import { computeBudgetSummary } from '../../store/moneySelectors';
import { formatMoney } from '../../util/format';
import { SUMMARY_CARD_ID, type MoneyTone } from './budgetKinds';
import { useCardHeight } from './useCardHeight';

// The computed cross-section figures. The three bottom-line numbers (net worth, monthly
// surplus, goals) are big colored KPI tiles; the supporting totals list below, each tinted
// by financial meaning (green in, red owed, orange out). Never edited — always derived.
export function BudgetSummary({ budget, onMeasure }: { budget: Budget; onMeasure?: (id: string, height: number) => void }) {
  const summary = computeBudgetSummary(budget);
  const rootRef = useCardHeight(SUMMARY_CARD_ID, onMeasure);

  const signTone = (value: number): MoneyTone => (value < 0 ? 'negative' : 'positive');
  const tiles: { label: string; value: number; tone: MoneyTone }[] = [
    { label: 'Net Worth', value: summary.netTotal, tone: signTone(summary.netTotal) },
    { label: 'Surplus / mo', value: summary.netMonthlySurplus, tone: signTone(summary.netMonthlySurplus) },
    { label: 'Goals', value: summary.goalsTotal, tone: 'goals' },
  ];
  const rows: { label: string; value: number; tone: MoneyTone; strong?: boolean }[] = [
    { label: 'Total Income', value: summary.totalIncome, tone: 'positive' },
    { label: 'Total Assets', value: summary.totalAssets, tone: 'positive' },
    { label: 'Total Liabilities', value: summary.totalLiabilities, tone: 'negative' },
    { label: 'Total Bills', value: summary.totalBills, tone: 'expense' },
    { label: 'Total Other Expenses', value: summary.totalOtherExpenses, tone: 'expense' },
    { label: 'Total Monthly Expenses', value: summary.totalMonthlyExpenses, tone: 'expense', strong: true },
  ];

  return (
    <section ref={rootRef} className="budget-section budget-summary">
      <header className="budget-section-head">
        <span className="budget-drag-grip" title="Drag to move" aria-hidden="true">&#10303;</span>
        <div className="budget-section-title budget-summary-heading">Summary</div>
      </header>
      <div className="budget-section-body">
        <div className="budget-kpis">
          {tiles.map((tile) => (
            <div key={tile.label} className={'budget-kpi budget-tone-' + tile.tone}>
              <div className="budget-kpi-value">{formatMoney(tile.value)}</div>
              <div className="budget-kpi-label">{tile.label}</div>
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.label} className={'budget-summary-row' + (row.strong ? ' strong' : '')}>
            <span className="budget-summary-label">{row.label}</span>
            <span className={'budget-summary-value budget-tone-' + row.tone}>{formatMoney(row.value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
