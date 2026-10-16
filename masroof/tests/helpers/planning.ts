import type {
  NotificationPermission,
  NotificationsPort,
} from '@/services/notifications/notifications';
import { createPlanningService, type PlanningTexts } from '@/services/planning/planning-service';

import type { Ledger } from './ledger';
import { TZ } from './ledger';

export type FakeNotifications = NotificationsPort & {
  permission: NotificationPermission;
  presented: { id: string; title: string; body: string }[];
  scheduled: Map<string, { at: number; title: string; body: string }>;
  requests: number;
};

export function fakeNotifications(
  permission: NotificationPermission = 'granted',
): FakeNotifications {
  const n: FakeNotifications = {
    permission,
    presented: [],
    scheduled: new Map(),
    requests: 0,
    status: async () => n.permission,
    request: async () => {
      n.requests++;
      if (n.permission === 'undetermined') n.permission = 'granted';
      return n.permission;
    },
    present: async (x) => {
      n.presented.push(x);
    },
    scheduleAt: async (x) => {
      n.scheduled.set(x.id, { at: x.at, title: x.title, body: x.body });
    },
    cancel: async (id) => {
      n.scheduled.delete(id);
    },
    scheduledIds: async () => [...n.scheduled.keys()],
    cancelAll: async () => {
      n.scheduled.clear();
    },
  };
  return n;
}

/** Plain copy that makes assertions readable (and proves no amounts leak). */
export const testTexts: PlanningTexts = {
  ruleLabel: (r) => r.template.payeeName ?? 'rule',
  budgetLabel: (id) => id ?? 'overall',
  dueTitle: (label, mode) => `${label} due (${mode})`,
  dueBody: () => 'Open Masroof',
  recordedTitle: (n) => `${n} recorded`,
  recordedBody: () => 'Recurring',
  waitingTitle: (n) => `${n} waiting`,
  waitingBody: () => 'Upcoming',
  budgetTitle: (label, t) => `${label} ${t}%`,
  budgetBody: (t) => `Reached ${t}%`,
};

export function planningFor(l: Ledger, notifications = fakeNotifications()) {
  return {
    notifications,
    planning: createPlanningService({
      ...l,
      repos: l.repos,
      notifications,
      texts: () => testTexts,
      timeZone: () => TZ,
    }),
  };
}

/** Set the fake clock to 10:00 Khartoum time on a date. */
export function setDay(l: Ledger, date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  l.clock.now = Date.UTC(y, m - 1, d, 8, 0);
}
