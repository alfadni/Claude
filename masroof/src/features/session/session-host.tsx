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
    };
  }, [ready, state.bump, state.updateSetting]);
  if (!value) return null;
  return <SessionProvider value={value}>{children}</SessionProvider>;
}
