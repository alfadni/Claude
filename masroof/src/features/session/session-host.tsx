import { useMemo, type ReactNode } from 'react';

import { useBootStore } from '../boot/boot-store';
import { SessionProvider, type Session } from './session';

/** Bridges the boot store to the SessionContext used by every screen. */
export function SessionHost({ children }: { children: ReactNode }) {
  const state = useBootStore();
  const ready = state.status === 'ready' ? state : null;
  const value = useMemo<Session | null>(() => {
    if (!ready) return null;
    const { services } = ready;
    return {
      repos: services.repos,
      onboarding: services.onboarding,
      attachments: services.attachments,
      pickImage: services.platform.pickImage,
      openSystemSettings: services.platform.openSystemSettings,
      haptic: services.platform.haptic,
      timeZone: services.device.timeZone,
      settings: ready.settings,
      version: ready.version,
      bump: state.bump,
      updateSetting: state.updateSetting,
      lock: services.lock,
      security: ready.security,
      refreshSecurity: state.refreshSecurity,
      backup: services.backup,
      csv: services.csv,
      reset: services.reset,
      exportCsv: services.exportCsv,
      shareBytes: services.platform.shareBytes,
      pickFile: services.platform.pickFile,
      reloadApp: services.platform.reloadApp,
      planning: services.planning,
      notificationPermission: ready.planning.permission,
      planningNotice: ready.planning.notice,
      dismissPlanningNotice: state.dismissPlanningNotice,
      requestNotifications: state.requestNotifications,
      crashReportsAvailable: services.platform.crashReporter.available,
    };
  }, [
    ready,
    state.bump,
    state.updateSetting,
    state.refreshSecurity,
    state.dismissPlanningNotice,
    state.requestNotifications,
  ]);
  if (!value) return null;
  return <SessionProvider value={value}>{children}</SessionProvider>;
}
