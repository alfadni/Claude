import { localDateOf, type LocalDate } from '@/domain';

import type { DataDeps } from '../database';
import { createAccountsRepository } from './accounts-repository';
import { createAttachmentsRepository } from './attachments-repository';
import { createBaseCurrencyRepository } from './base-currency-repository';
import { createBudgetsRepository } from './budgets-repository';
import { createCategoryMerge } from './category-merge';
import { createCategoriesRepository } from './categories-repository';
import { createDraftsRepository } from './drafts-repository';
import { createFxRatesRepository } from './fx-rates-repository';
import { createGoalsRepository } from './goals-repository';
import { createNamesRepository } from './names-repository';
import { createRecurringRepository } from './recurring-repository';
import { createReportsRepository } from './reports-repository';
import { createSettingsRepository } from './settings-repository';
import { createTransactionsRepository } from './transactions-repository';

/** One place that wires repositories together for the app and for tests. */
export function createRepositories(deps: DataDeps & { timeZone: () => string }) {
  const today = (): LocalDate => localDateOf(deps.now(), deps.timeZone());
  const settings = createSettingsRepository(deps);
  const accounts = createAccountsRepository(deps);
  const categories = createCategoriesRepository(deps);
  const names = createNamesRepository(deps);
  const fx = createFxRatesRepository(deps);
  const transactions = createTransactionsRepository({
    ...deps,
    today,
    settings,
    accounts,
    categories,
    names,
    fx,
  });
  const reports = createReportsRepository({ ...deps, settings, accounts, fx });
  const drafts = createDraftsRepository(deps);
  const attachments = createAttachmentsRepository(deps);
  const recurring = createRecurringRepository({ ...deps, today, transactions });
  const budgets = createBudgetsRepository({
    ...deps,
    today,
    settings,
    categories,
    fx,
  });
  const goals = createGoalsRepository({ ...deps, today, accounts, fx });
  const categoryMerge = createCategoryMerge({ ...deps, categories, budgets });
  const baseCurrency = createBaseCurrencyRepository({ ...deps, today, settings, fx, reports });
  return {
    today,
    settings,
    accounts,
    categories,
    names,
    fx,
    transactions,
    reports,
    drafts,
    attachments,
    recurring,
    budgets,
    goals,
    categoryMerge,
    baseCurrency,
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
