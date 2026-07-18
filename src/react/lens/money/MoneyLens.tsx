import { Suspense, lazy, useEffect, useState } from 'react';
import { useCalData } from '../../store/calStore';
import { getBudgets } from '../../store/moneySelectors';
import { ensureBudget } from '../../store/moneyActions';
import { LensLayout } from '../LensLayout';
import type { LensId } from '../lenses';
import { BudgetsSidebar } from './BudgetsSidebar';

// react-grid-layout only loads when a budget is actually shown.
const BudgetCanvas = lazy(() => import('./BudgetCanvas'));

// The Money lens: sidebar = the project's budgets; main = the active budget re-created as
// an editable grid (imitating the user's spreadsheet) with a computed Summary.
export function MoneyLens({ lens, onSelectLens }: { lens: LensId; onSelectLens: (lens: LensId) => void }) {
  const calData = useCalData();
  const budgets = getBudgets(calData);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Seed a default budget (from the user's spreadsheet) the first time this project's
  // Money lens opens with none. `ensureBudget` is idempotent, so this fires at most once.
  useEffect(() => {
    if (!budgets.length) void ensureBudget(calData);
  }, [calData, budgets.length]);

  const activeBudget = budgets.find((budget) => budget.id === activeId) ?? budgets[0];

  const sidebar = budgets.length ? (
    <BudgetsSidebar calData={calData} budgets={budgets} activeId={activeBudget?.id ?? ''} onSelect={setActiveId} />
  ) : (
    <div className="lens-empty">Setting up your budget…</div>
  );

  const main = activeBudget ? (
    <div className="budget-main">
      <Suspense fallback={<div className="lens-empty">Loading budget…</div>}>
        <BudgetCanvas calData={calData} budget={activeBudget} />
      </Suspense>
    </div>
  ) : (
    <div className="lens-placeholder">
      <div className="lens-placeholder-title">Money</div>
      <div className="lens-placeholder-note">Setting up your budget…</div>
    </div>
  );

  return <LensLayout lens={lens} onSelectLens={onSelectLens} sidebar={sidebar} main={main} />;
}
