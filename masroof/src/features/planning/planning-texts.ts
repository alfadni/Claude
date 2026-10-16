import type { TFunction } from 'i18next';

import type { Repositories } from '@/data/repositories';
import type { Rule } from '@/data/repositories/recurring-repository';
import type { PlanningTexts } from '@/services/planning/planning-service';

import { localizedCategoryName, tDynamic } from '../session/use-format';

/** A rule's display label: payee, else note, else its main category. */
export function ruleLabel(t: TFunction, repos: Repositories, rule: Rule): string {
  const tpl = rule.template;
  if (tpl.payeeName) return tpl.payeeName;
  if (tpl.note) return tpl.note.length > 40 ? `${tpl.note.slice(0, 39)}…` : tpl.note;
  if (tpl.type === 'transfer') return t('quickAdd.typeTransfer');
  const main = [...tpl.splits].sort((a, b) => b.amountMinor - a.amountMinor)[0];
  return localizedCategoryName(t, main ? repos.categories.get(main.categoryId) : undefined);
}

export function budgetLabel(t: TFunction, repos: Repositories, categoryId: string | null): string {
  return categoryId
    ? localizedCategoryName(t, repos.categories.get(categoryId))
    : t('budgets.overall');
}

/**
 * Notification copy (ADR-014): labels and events only, never amounts or
 * balances, because notifications show on the lock screen.
 */
export function planningTexts(t: TFunction, repos: Repositories): PlanningTexts {
  return {
    ruleLabel: (rule) => ruleLabel(t, repos, rule),
    budgetLabel: (id) => budgetLabel(t, repos, id),
    dueTitle: (label) => t('planning.notify.dueTitle', { label }),
    dueBody: (mode) => tDynamic(t, `planning.notify.dueBody_${mode}`),
    recordedTitle: (count) => t('planning.notify.recordedTitle', { count }),
    recordedBody: () => t('planning.notify.recordedBody'),
    waitingTitle: (count) => t('planning.notify.waitingTitle', { count }),
    waitingBody: () => t('planning.notify.waitingBody'),
    budgetTitle: (label, threshold) => t('planning.notify.budgetTitle', { label, threshold }),
    budgetBody: () => t('planning.notify.budgetBody'),
  };
}
