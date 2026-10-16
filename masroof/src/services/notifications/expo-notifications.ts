import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationPermission, NotificationsPort } from './notifications';

const CHANNEL = 'reminders';

function toPermission(p: Notifications.NotificationPermissionsStatus): NotificationPermission {
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

let configured = false;
async function configure() {
  if (configured) return;
  configured = true;
  // Show alerts while the app is open too (J6: the alert fires on the save that crosses it).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Reminders',
      importance: AndroidImportance.DEFAULT,
    });
  }
}

/** Errors are swallowed: a notification must never break a save or a launch. */
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    await configure();
    return await fn();
  } catch {
    return fallback;
  }
};

export const expoNotifications: NotificationsPort = {
  status: () => safe(async () => toPermission(await Notifications.getPermissionsAsync()), 'denied'),
  request: () =>
    safe(async () => toPermission(await Notifications.requestPermissionsAsync()), 'denied'),
  present: (n) =>
    safe(async () => {
      await Notifications.scheduleNotificationAsync({
        identifier: n.id,
        content: { title: n.title, body: n.body },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
      });
    }, undefined),
  scheduleAt: (n) =>
    safe(async () => {
      await Notifications.cancelScheduledNotificationAsync(n.id);
      await Notifications.scheduleNotificationAsync({
        identifier: n.id,
        content: { title: n.title, body: n.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(n.at),
          channelId: CHANNEL,
        },
      });
    }, undefined),
  cancel: (id) => safe(() => Notifications.cancelScheduledNotificationAsync(id), undefined),
  scheduledIds: () =>
    safe(
      async () =>
        (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier),
      [],
    ),
  cancelAll: () => safe(() => Notifications.cancelAllScheduledNotificationsAsync(), undefined),
};
