/**
 * Local notifications port (ADR-014). The engine and inbox never depend on
 * it: with permission denied, everything still works in-app (J5).
 *
 * Content rule: notifications show on the lock screen, so they never carry
 * amounts, notes or balances — only a category/payee label and the event.
 */
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export type LocalNotification = Readonly<{ id: string; title: string; body: string }>;

export interface NotificationsPort {
  status(): Promise<NotificationPermission>;
  /** Asks the OS (only shows a prompt while undetermined). */
  request(): Promise<NotificationPermission>;
  present(n: LocalNotification): Promise<void>;
  /** Schedule at an absolute instant; an existing id is replaced. */
  scheduleAt(n: LocalNotification & { at: number }): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Ids currently scheduled by this app. */
  scheduledIds(): Promise<string[]>;
  cancelAll(): Promise<void>;
}

/** A port that does nothing (tests, or a platform without notifications). */
export const silentNotifications: NotificationsPort = {
  status: async () => 'denied',
  request: async () => 'denied',
  present: async () => undefined,
  scheduleAt: async () => undefined,
  cancel: async () => undefined,
  scheduledIds: async () => [],
  cancelAll: async () => undefined,
};
