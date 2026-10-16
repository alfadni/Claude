import { localDateOf, type LocalDate } from '@/domain';

import type { DataDeps } from '../database';
import { createAccountsRepository } from './accounts-repository';
import { createAttachmentsRepository } from './attachments-repository';
import { createCategoriesRepository } from './categories-repository';
import { createDraftsRepository } from './drafts-repository';
import { createFxRatesRepository } from './fx-rates-repository';
import { createNamesRepository } from './names-repository';
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
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
