import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useBootStore } from '@/features/boot/boot-store';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { restartForDirection } from '@/i18n/direction';

export default function SettingsRoute() {
  const { t } = useTranslation();
  const state = useBootStore();
  if (state.status !== 'ready') return null;
  return (
    <SettingsScreen
      settings={state.settings}
      restartRequired={state.restartRequired}
      onChange={state.updateSetting}
      onRestart={() => void restartForDirection()}
      onNavigate={(to) => router.push(`/${to}`)}
      t={t}
    />
  );
}
