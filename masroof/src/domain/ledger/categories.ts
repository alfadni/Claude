import type { CategoryKind } from './transaction';

export type SeedCategory = Readonly<{
  seedKey: string;
  /** Stored English name; shown localised via i18n until the user renames it. */
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
}>;

/**
 * Default categories, matching the baseline app (spec Phase 1) with one
 * deliberate change: "Savings" is not an income category (G1). Money set
 * aside goes to a savings *account* via a transfer, so income totals stay true.
 * Names are localised from `seedKey` (categories.seed.<key>) until the user renames.
 */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { seedKey: 'bills', name: 'Bills', kind: 'expense', icon: '🧾', color: '#B45309' },
  { seedKey: 'auto', name: 'Auto', kind: 'expense', icon: '🚗', color: '#1D4ED8' },
  { seedKey: 'home', name: 'Home', kind: 'expense', icon: '🏠', color: '#7C3AED' },
  { seedKey: 'kids', name: 'Kids', kind: 'expense', icon: '🧸', color: '#DB2777' },
  { seedKey: 'clothes', name: 'Clothes', kind: 'expense', icon: '👕', color: '#0E7490' },
  { seedKey: 'food', name: 'Food', kind: 'expense', icon: '🍽️', color: '#B91C1C' },
  { seedKey: 'fuel', name: 'Fuel', kind: 'expense', icon: '⛽', color: '#92400E' },
  {
    seedKey: 'entertainment',
    name: 'Entertainment',
    kind: 'expense',
    icon: '🎬',
    color: '#6D28D9',
  },
  { seedKey: 'health', name: 'Health', kind: 'expense', icon: '🩺', color: '#047857' },
  { seedKey: 'other_expense', name: 'Other', kind: 'expense', icon: '📦', color: '#4B5563' },
  { seedKey: 'salary', name: 'Salary', kind: 'income', icon: '💼', color: '#047857' },
  { seedKey: 'gifts', name: 'Gifts', kind: 'income', icon: '🎁', color: '#BE185D' },
  { seedKey: 'other_income', name: 'Other income', kind: 'income', icon: '➕', color: '#4B5563' },
];

export const MAX_CATEGORY_NAME = 40;

export type NameError = 'name_empty' | 'name_too_long';

export function validateName(name: string, max: number): NameError | null {
  const n = name.trim();
  if (n.length === 0) return 'name_empty';
  if (n.length > max) return 'name_too_long';
  return null;
}
