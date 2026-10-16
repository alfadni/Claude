import type { DataDeps } from '@/data/database';
import type { Repositories } from '@/data/repositories';
import type { CrossedAlert } from '@/data/repositories/budgets-repository';
import type { Rule } from '@/data/repositories/recurring-repository';
import { startOfDayInZone, type RecurringMode } from '@/domain';

import type { NotificationPermission, NotificationsPort } from '../notifications/notifications';
import { runRecurrenceEngine, type EngineSummary } from './recurrence-engine';

/** Localised copy, supplied by the UI layer (services stay i18n-free). */
export type PlanningTexts = Readonly<{
  ruleLabel: (rule: Rule) => string;
  budgetLabel: (categoryId: string | null) => string;
  dueTitle: (label: string, mode: RecurringMode) => string;
  dueBody: (mode: RecurringMode) => string;
  recordedTitle: (count: number) => string;
  recordedBody: () => string;
  waitingTitle: (count: number) => string;
  waitingBody: () => string;
  budgetTitle: (label: string, threshold: number) => string;
  budgetBody: (threshold: number) => string;
}>;

export type PlanningRun = EngineSummary & { alerts: CrossedAlert[] };

export const REMINDER_HOUR = 9;
const RULE_PREFIX = 'recurring:';

export function createPlanningService(
  deps: DataDeps & {
    repos: Repositories;
    notifications: NotificationsPort;
    texts: () => PlanningTexts;
    timeZone: () => string;
  },
) {
  const { repos, notifications } = deps;

  async function announceAlerts(alerts: readonly CrossedAlert[]) {
    if (alerts.length === 0 || (await notifications.status()) !== 'granted') return;
    const t = deps.texts();
    for (const a of alerts) {
      await notifications.present({
        id: `budget:${a.budgetId}:${a.threshold}`,
        title: t.budgetTitle(t.budgetLabel(a.categoryId), a.threshold),
        body: t.budgetBody(a.threshold),
      });
    }
  }

  const api = {
    permission: (): Promise<NotificationPermission> => notifications.status(),

    /**
     * Ask in context (first rule or budget), never at launch. Returns the
     * resulting state; denied simply means in-app only (J5).
     */
    async ensurePermission(): Promise<NotificationPermission> {
      const s = await notifications.status();
      return s === 'undetermined' ? notifications.request() : s;
    },

    /** After any ledger write: record crossed thresholds and alert (J2, J6). */
    async afterWrite(): Promise<CrossedAlert[]> {
      let alerts: CrossedAlert[] = [];
      try {
        alerts = repos.budgets.recordCrossings();
      } catch {
        return [];
      }
      await announceAlerts(alerts);
      return alerts;
    },

    /** Next occurrence of each active rule at 09:00 local; stale ones cancelled. */
    async refreshReminders(): Promise<void> {
      if ((await notifications.status()) !== 'granted') return;
      const t = deps.texts();
      const now = deps.now();
      const wanted = new Set<string>();
      for (const rule of repos.recurring.list().rules) {
        if (rule.isPaused || !rule.nextOn) continue;
        const at = startOfDayInZone(rule.nextOn, deps.timeZone()) + REMINDER_HOUR * 3_600_000;
        if (at <= now) continue; // already due: the engine handles it on open
        const id = `${RULE_PREFIX}${rule.id}`;
        wanted.add(id);
        await notifications.scheduleAt({
          id,
          at,
          title: t.dueTitle(t.ruleLabel(rule), rule.mode),
          body: t.dueBody(rule.mode),
        });
      }
      for (const id of await notifications.scheduledIds()) {
        if (id.startsWith(RULE_PREFIX) && !wanted.has(id)) await notifications.cancel(id);
      }
    },

    /**
     * App open, foreground on a new day, or background task. In the
     * background the user is told what happened via a notification; in the
     * foreground the inbox badge and Home show it.
     */
    async run(options: { background: boolean }): Promise<PlanningRun> {
      const summary = runRecurrenceEngine({ ...deps, repos }, repos.today());
      const alerts = await api.afterWrite();
      if (options.background && (await notifications.status()) === 'granted') {
        const t = deps.texts();
        if (summary.posted > 0) {
          await notifications.present({
            id: `recorded:${deps.now()}`,
            title: t.recordedTitle(summary.posted),
            body: t.recordedBody(),
          });
        }
        if (summary.pending > 0) {
          await notifications.present({
            id: `waiting:${deps.now()}`,
            title: t.waitingTitle(summary.pending),
            body: t.waitingBody(),
          });
        }
      }
      await api.refreshReminders();
      return { ...summary, alerts };
    },
  };
  return api;
}

export type PlanningService = ReturnType<typeof createPlanningService>;
