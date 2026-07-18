import { useState } from 'react';
import type { Budget, CalData } from '../../../types';
import { addBudget, deleteBudget, renameBudget } from '../../store/moneyActions';
import { ConfirmDialog } from '../../tabs/ConfirmDialog';

// The Money lens's sidebar list: a project can hold several budgets (e.g. Personal /
// Business). Click to switch, double-click to rename inline, × to delete. Mirrors the
// project TabBar's interaction patterns.
export function BudgetsSidebar({
  calData,
  budgets,
  activeId,
  onSelect,
}: {
  calData: CalData;
  budgets: Budget[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Budget | null>(null);

  function commitRename() {
    if (editingId) void renameBudget(calData, editingId, draft);
    setEditingId(null);
    setDraft('');
  }

  async function handleAdd() {
    const id = await addBudget(calData);
    if (id) onSelect(id);
  }

  return (
    <>
      <div className="budget-list-head">Budgets</div>
      <div className="budget-list">
        {budgets.map((budget) => (
          <div
            key={budget.id}
            className={'budget-list-item' + (budget.id === activeId ? ' active' : '')}
            onClick={() => { if (editingId !== budget.id) onSelect(budget.id); }}
            onDoubleClick={() => { setEditingId(budget.id); setDraft(budget.name); }}
          >
            {editingId === budget.id ? (
              <input
                className="budget-list-input"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitRename}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename();
                  else if (event.key === 'Escape') { setEditingId(null); setDraft(''); }
                }}
              />
            ) : (
              <>
                <span className="budget-list-name">{budget.name}</span>
                {budgets.length > 1 && (
                  <button
                    className="budget-list-del"
                    title="Delete budget"
                    onClick={(event) => { event.stopPropagation(); setPendingDelete(budget); }}
                  >
                    &#10005;
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <button className="budget-add" onClick={() => void handleAdd()}>+ New budget</button>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          message="This budget and all its sections will be removed permanently. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            const remaining = budgets.filter((budget) => budget.id !== pendingDelete.id);
            if (pendingDelete.id === activeId && remaining[0]) onSelect(remaining[0].id);
            void deleteBudget(calData, pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
