import { createRepositories, type Repositories } from '@/data/repositories';
import { createIdFactory } from '@/domain';

import { DB_KEY_NAME, openEncryptedDatabase, type OpenDeps } from '../db/open-database';
import type { NotificationsPort } from '../notifications/notifications';
import { createPlanningService, type PlanningRun, type PlanningTexts } from './planning-service';

/**
 * Background-task entry (ADR-013): open the encrypted DB, run the engine,
 * close. Never creates a key: with no key (fresh install, or the keychain is
 * unreadable while the device is locked) it does nothing and the next app
 * open catches up.
 */
export async function runPlanningHeadless(deps: {
  open: OpenDeps;
  randomBytes: (n: number) => Uint8Array;
  notifications: NotificationsPort;
  texts: (repos: Repositories) => PlanningTexts;
  timeZone: () => string;
}): Promise<PlanningRun | null> {
  let key: string | null;
  try {
    key = await deps.open.secrets.get(DB_KEY_NAME);
  } catch {
    return null;
  }
  if (key === null) return null;
  const result = await openEncryptedDatabase(deps.open);
  if (result.status !== 'ready') return null;
  try {
    const data = {
      db: result.connection.db,
      sql: result.connection.sql,
      now: Date.now,
      newId: createIdFactory(deps.randomBytes),
    };
    const repos = createRepositories({ ...data, timeZone: deps.timeZone });
    if (repos.settings.get('onboardingStep') === 'none') return null;
    const planning = createPlanningService({
      ...data,
      repos,
      notifications: deps.notifications,
      texts: () => deps.texts(repos),
      timeZone: deps.timeZone,
    });
    return await planning.run({ background: true });
  } finally {
    result.connection.close();
  }
}
