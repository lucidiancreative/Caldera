import { useEffect, useRef, useState } from 'react';
import type { BudgetColumn } from './budgetKinds';
import type { BudgetItem, BudgetSection as BudgetSectionType, CalData } from '../../../types';
import { BUDGET_ACCENT_PRESETS, BUDGET_KINDS, sectionTotalTone } from './budgetKinds';
import { sectionColumnTotals } from '../../store/moneySelectors';
import {
  addItem,
  deleteItem,
  deleteSection,
  duplicateSection,
  renameSection,
  setItemDate,
  setItemValue,
  setSectionColor,
  toggleSectionCollapsed,
  updateItemLabel,
} from '../../store/moneyActions';
import { formatMoney } from '../../util/format';
import { ConfirmDialog } from '../../tabs/ConfirmDialog';
import { EditableCell } from './EditableCell';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { useCardHeight } from './useCardHeight';

const INDENT_STEP = 16;

// One budget section: an editable, indentable tree of rows with a per-column Total row.
// Drag by the grip in its header; right-click for section actions. The same component
// renders every kind — its columns come from the kind registry.
export function BudgetSection({
  calData,
  budgetId,
  section,
  onMeasure,
}: {
  calData: CalData;
  budgetId: string;
  section: BudgetSectionType;
  onMeasure?: (id: string, height: number) => void;
}) {
  const def = BUDGET_KINDS[section.kind];
  const totals = sectionColumnTotals(section);
  const totalTone = sectionTotalTone(section.kind);
  const stripe = section.color ?? def.accent;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useCardHeight(section.id, onMeasure);

  const menuItems: ContextMenuItem[] = [
    { label: 'Add row', onClick: () => void addItem(calData, budgetId, section.id, null) },
    { label: 'Duplicate section', onClick: () => void duplicateSection(calData, budgetId, section.id) },
    { label: section.collapsed ? 'Expand' : 'Collapse', onClick: () => void toggleSectionCollapsed(calData, budgetId, section.id) },
    { label: 'Delete section', danger: true, separatorBefore: true, onClick: () => setConfirmingDelete(true) },
  ];

  return (
    <section
      ref={rootRef}
      className={'budget-section budget-section-' + section.kind}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}
    >
      <header className="budget-section-head" style={{ borderLeftColor: stripe }}>
        <span className="budget-drag-grip" title="Drag to move" aria-hidden="true">&#10303;</span>
        <div className="budget-section-title">
          <EditableCell display={section.title} onCommit={(value) => void renameSection(calData, budgetId, section.id, value)} />
        </div>
      </header>

      {!section.collapsed && (
        <div className="budget-section-body">
          <div className="budget-row budget-colhead">
            <div className="budget-c-label" />
            {def.columns.map((col) => <div className="budget-c-val" key={col.id}>{col.label}</div>)}
            {def.hasDate && <div className="budget-c-date">Date</div>}
            <div className="budget-c-actions" />
          </div>

          {section.items.map((item) => (
            <BudgetRow
              key={item.id}
              calData={calData}
              budgetId={budgetId}
              sectionId={section.id}
              columns={def.columns}
              hasDate={!!def.hasDate}
              item={item}
              depth={0}
            />
          ))}

          <button className="budget-add-row" onClick={() => void addItem(calData, budgetId, section.id, null)}>+ Add row</button>

          <div className="budget-row budget-total">
            <div className="budget-c-label">Total</div>
            {def.columns.map((col) => (
              <div className={'budget-c-val' + (totalTone ? ' budget-tone-' + totalTone : '')} key={col.id}>{formatMoney(totals[col.id])}</div>
            ))}
            {def.hasDate && <div className="budget-c-date" />}
            <div className="budget-c-actions" />
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          footer={
            <>
              <div className="budget-ctx-label">Panel color</div>
              <ColorSwatches current={section.color} onPick={(color) => void setSectionColor(calData, budgetId, section.id, color)} />
            </>
          }
          onClose={() => setMenu(null)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete “${section.title}”?`}
          message="This section and all its rows will be removed. You can undo with Ctrl+Z."
          confirmLabel="Delete"
          onConfirm={() => { void deleteSection(calData, budgetId, section.id); setConfirmingDelete(false); }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </section>
  );
}

function BudgetRow({
  calData,
  budgetId,
  sectionId,
  columns,
  hasDate,
  item,
  depth,
}: {
  calData: CalData;
  budgetId: string;
  sectionId: string;
  columns: BudgetColumn[];
  hasDate: boolean;
  item: BudgetItem;
  depth: number;
}) {
  return (
    <>
      <div className="budget-row">
        <div className="budget-c-label" style={{ paddingLeft: 4 + depth * INDENT_STEP }}>
          <EditableCell display={item.label} onCommit={(value) => void updateItemLabel(calData, budgetId, sectionId, item.id, value)} />
        </div>

        {columns.map((col) => {
          const value = item.values[col.id];
          const has = typeof value === 'number' && Number.isFinite(value);
          return (
            <div className="budget-c-val" key={col.id}>
              <EditableCell
                numeric
                align="right"
                placeholder="—"
                display={has ? formatMoney(value) : ''}
                edit={has ? String(value) : ''}
                onCommit={(raw) => {
                  const trimmed = raw.trim();
                  const parsed = trimmed === '' ? null : parseFloat(trimmed.replace(/[^0-9.-]/g, ''));
                  void setItemValue(calData, budgetId, sectionId, item.id, col.id, parsed);
                }}
              />
            </div>
          );
        })}

        {hasDate && (
          <div className="budget-c-date">
            <EditableCell placeholder="—" display={item.date ?? ''} onCommit={(value) => void setItemDate(calData, budgetId, sectionId, item.id, value)} />
          </div>
        )}

        <div className="budget-c-actions">
          <button className="budget-row-btn" title="Add sub-item" onClick={() => void addItem(calData, budgetId, sectionId, item.id)}>+</button>
          <button className="budget-row-btn budget-del" title="Delete row" onClick={() => void deleteItem(calData, budgetId, sectionId, item.id)}>&#10005;</button>
        </div>
      </div>

      {item.children?.map((child) => (
        <BudgetRow
          key={child.id}
          calData={calData}
          budgetId={budgetId}
          sectionId={sectionId}
          columns={columns}
          hasDate={hasDate}
          item={child}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

// Preset stripe colours + a native custom picker, shown in a section's right-click menu.
// Picking applies live and leaves the menu open, so several colours can be tried. Presets
// commit instantly; the native picker fires onChange continuously while dragging, so its
// commit is debounced (and the input is uncontrolled) to avoid a burst of disk writes.
function ColorSwatches({ current, onPick }: { current?: string; onPick: (color: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function pickDebounced(color: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onPick(color), 150);
  }

  return (
    <div className="budget-ctx-colors">
      {BUDGET_ACCENT_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          className={'budget-color-swatch' + (current?.toLowerCase() === color.toLowerCase() ? ' active' : '')}
          style={{ background: color }}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}
      <label className="budget-color-swatch budget-color-custom" title="Custom color">
        <input key={current ?? 'none'} type="color" defaultValue={current || '#8e8e93'} onChange={(event) => pickDebounced(event.target.value)} />
      </label>
    </div>
  );
}
