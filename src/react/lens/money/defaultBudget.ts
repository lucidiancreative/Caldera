import type { Budget, BudgetItem, BudgetSection, BudgetSectionKind } from '../../../types';
import { BUDGET_KINDS, BUDGET_KIND_ORDER } from './budgetKinds';

// Seed data for the Money lens. `makeDefaultBudget` re-creates the user's personal budget
// spreadsheet so a new project's Money matches it out of the box; every value stays fully
// editable afterwards. `makeEmptyBudget` gives the same section skeleton with no rows, for
// the additional budgets a user adds from the sidebar.

let idCounter = 0;
function bid(): string {
  idCounter += 1;
  return 'bud' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 5);
}

function item(label: string, values: Record<string, number> = {}, extra?: { date?: string; children?: BudgetItem[] }): BudgetItem {
  const node: BudgetItem = { id: bid(), label, values };
  if (extra?.date) node.date = extra.date;
  if (extra?.children) node.children = extra.children;
  return node;
}

function section(kind: BudgetSectionKind, items: BudgetItem[]): BudgetSection {
  return { id: bid(), kind, title: BUDGET_KINDS[kind].defaultTitle, items };
}

export function makeDefaultBudget(name = 'Personal'): Budget {
  return {
    id: bid(),
    name,
    sections: [
      section('income', [
        item('Salary 1', { amount: 4100 }),
        item('Salary 2'),
        item('Additional'),
        item('Royalties'),
      ]),
      section('assets', [
        item('Checking', { total: 1273.91 }),
        item('Investments (15-20%)', { allocation: 890.2, total: 0 }, {
          children: [
            item('Equities (70-80%)', { allocation: 508 }),
            item("Bonds, CD's (20-30%)", { allocation: 127 }),
          ],
        }),
        item('Business', { allocation: 2088, total: 0 }),
        item('Crypto', { total: 0 }),
        item('Real Estate'),
        item('Other (Colorado)', { total: 10000 }),
        item('Funds', {}, {
          children: [
            item('Emergency Fund', { total: 0 }),
            item('Business Fund', { total: 0 }),
            item('Family Fund', { total: 0 }),
          ],
        }),
      ]),
      section('liabilities', [
        item('Debt', {}, {
          children: [
            item('Auto Loan (5%)'),
            item('Personal Loan (2.5%)'),
            item('Student Loan (2.5%)'),
            item('Credit', { total: 5431 }),
          ],
        }),
      ]),
      section('bills', [
        item('Rent (48%)', { monthly: 825, check1: 425, check2: 425 }),
        item('Gas (17%)', { monthly: 120, check1: 60, check2: 60 }),
        item('Food (17%)', { monthly: 300, check1: 150, check2: 150 }),
        item('Power (2%)', { monthly: 35, check1: 32, check2: 32 }),
        item('Phone (1%)', { monthly: 20, check1: 10, check2: 10 }),
        item('Gym / Training', { monthly: 50, check1: 25, check2: 25 }),
        item('Internet (2%)', { monthly: 30, check1: 15, check2: 15 }),
        item('Insurance (3%)', { monthly: 62, check1: 31, check2: 31 }),
        item('Other (10%)'),
      ]),
      section('funds', [
        item('Social Fund', {}, {
          children: [
            item('Dating', {}, {
              children: [
                item('Dinners', { amount: 120 }),
                item('Activities', { amount: 80 }),
              ],
            }),
            item('Clothing', { amount: 50 }),
            item('Teeth Straightening', { amount: 200 }),
          ],
        }),
        item('Goals Funds', {}, {
          children: [
            item('Truck', { amount: 100 }, {
              children: [
                item('Insurance'),
                item('Wiper Blades (1 Time/Year)'),
                item('Tires (8 years)'),
                item('Brakes (30,000)'),
                item('Fuel Filter (60,000)'),
                item('Fluids', {}, {
                  children: [
                    item('Oil (5,000)'),
                    item('Radiator (50,000)'),
                    item('Transmission (50,000)'),
                  ],
                }),
                item('Spark Plugs (30,000)'),
                item('Air Filters (50,000)'),
              ],
            }),
            item('Emergency Fund'),
            item('Business Fund'),
            item('Family Goals Fund'),
          ],
        }),
      ]),
      section('goals', [
        item('Credit Card to Zero', { goal: 5431 }, { date: '14-Aug' }),
        item('Truck Rebuild', { goal: 5000 }, { date: '14-Aug' }),
        item('Scar Tattoo', { goal: 500 }, { date: '1-Aug' }),
        item('Photos', { goal: 200 }, { date: '1-Aug' }),
        item('Apartment', { goal: 3000 }, { date: '1-Sep' }),
        item('Emergency Fund', { goal: 5000 }, { date: '1-Sep' }),
        item('Buenos Aires', { goal: 8000 }, { date: '2027' }),
        item('Wedding', { goal: 12000 }, { date: '2028' }),
        item('Children', { goal: 10000 }, { date: '2028' }),
      ]),
    ],
  };
}

export function makeEmptyBudget(name: string): Budget {
  return {
    id: bid(),
    name,
    sections: BUDGET_KIND_ORDER.map((kind) => section(kind, [])),
  };
}
