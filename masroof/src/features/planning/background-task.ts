import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { getRandomBytes } from 'expo-crypto';

import { createI18n } from '@/i18n';
import { expoOpenDeps } from '@/services/db/expo-connection';
import { expoNotifications } from '@/services/notifications/expo-notifications';
import { runPlanningHeadless } from '@/services/planning/headless';

import { readDeviceDefaults, useBootStore } from '../boot/boot-store';
import { planningTexts } from './planning-texts';

/** Background fetch for the recurrence engine (ADR-013). */
export const PLANNING_TASK = 'masroof-planning';
const MINIMUM_INTERVAL_MINUTES = 12 * 60;

// Must run at module load (imported by the root layout), as TaskManager requires.
TaskManager.defineTask(PLANNING_TASK, async () => {
  try {
    const state = useBootStore.getState();
    if (state.status === 'ready') {
      // App process alive in the background: reuse its open session.
      await state.services.planning.run({ background: true });
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    await runPlanningHeadless({
      open: expoOpenDeps,
      randomBytes: getRandomBytes,
      notifications: expoNotifications,
      texts: (repos) => planningTexts(createI18n(repos.settings.get('locale')).t, repos),
      timeZone: () => readDeviceDefaults().timeZone,
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Best effort: background execution may be restricted by the OS or the user. */
export async function registerPlanningTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(PLANNING_TASK)) return;
    await BackgroundTask.registerTaskAsync(PLANNING_TASK, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
  } catch {
    // The engine still runs on every app open.
  }
}
