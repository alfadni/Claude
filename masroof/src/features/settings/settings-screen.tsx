import type { TFunction } from 'i18next';

import type { SettingKey, Settings } from '@/domain/settings';
import { SUPPORTED_LOCALES } from '@/i18n';
import { Button, Card, ErrorState, Row, Screen, Stack, Text } from '@/ui';

type Option<T> = { value: T; label: string };

function Segmented<T extends string>({
  title,
  options,
  value,
  onSelect,
}: {
  title: string;
  options: Option<T>[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <Card accessibilityRole="radiogroup" accessibilityLabel={title}>
      <Text variant="bodyStrong">{title}</Text>
      <Row gap="sm" style={{ flexWrap: 'wrap' }}>
        {options.map((o) => (
          <Button
            key={o.value}
            label={o.label}
            variant="secondary"
            selected={o.value === value}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.value === value }}
            onPress={() => onSelect(o.value)}
          />
        ))}
      </Row>
    </Card>
  );
}

export function SettingsScreen({
  settings,
  restartRequired,
  onChange,
  onRestart,
  t,
}: {
  settings: Settings;
  restartRequired: boolean;
  onChange: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  onRestart: () => void;
  t: TFunction;
}) {
  return (
    <Screen scroll>
      {restartRequired ? (
        <ErrorState
          title={t('settings.restartTitle')}
          body={t('settings.restartBody')}
          action={{ label: t('settings.restartNow'), onPress: onRestart }}
        />
      ) : null}
      <Stack gap="lg">
        <Segmented
          title={t('settings.language')}
          value={settings.locale}
          options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
          onSelect={(v) => onChange('locale', v)}
        />
        <Segmented
          title={t('settings.theme')}
          value={settings.theme}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
          onSelect={(v) => onChange('theme', v)}
        />
        <Segmented
          title={t('settings.numerals')}
          value={settings.numerals}
          options={[
            { value: 'latn', label: t('settings.numeralsLatn') },
            { value: 'arab', label: t('settings.numeralsArab') },
          ]}
          onSelect={(v) => onChange('numerals', v)}
        />
      </Stack>
    </Screen>
  );
}
