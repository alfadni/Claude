import type { TFunction } from 'i18next';

import { NUMBER_FORMATS, type NumberFormatId, type Weekday } from '@/domain';
import type { SettingKey, Settings } from '@/domain/settings';
import { SUPPORTED_LOCALES } from '@/i18n';
import { Button, Card, ErrorState, Row, Screen, Stack, Text } from '@/ui';

import { tDynamic } from '../session/use-format';

type Option<T> = { value: T; label: string };

function Segmented<T extends string | number>({
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
            key={String(o.value)}
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

const FORMAT_SAMPLES: Record<NumberFormatId, string> = {
  en: '1,234.56',
  eu: '1.234,56',
  space: '1 234,56',
  plain: '1234.56',
};

export function SettingsScreen({
  settings,
  restartRequired,
  onChange,
  onRestart,
  onNavigate,
  t,
}: {
  settings: Settings;
  restartRequired: boolean;
  onChange: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  onRestart: () => void;
  onNavigate?: (
    to:
      | 'accounts'
      | 'categories'
      | 'trash'
      | 'security'
      | 'backup'
      | 'data'
      | 'reset'
      | 'upcoming'
      | 'recurring'
      | 'budgets'
      | 'goals',
  ) => void;
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
        {onNavigate ? (
          <Card>
            <Text variant="bodyStrong">{t('settings.manage')}</Text>
            <Button
              label={t('accounts.title')}
              variant="secondary"
              onPress={() => onNavigate('accounts')}
            />
            <Button
              label={t('categories.title')}
              variant="secondary"
              onPress={() => onNavigate('categories')}
            />
            <Button
              label={t('trash.title')}
              variant="secondary"
              onPress={() => onNavigate('trash')}
            />
          </Card>
        ) : null}
        {onNavigate ? (
          <Card>
            <Text variant="bodyStrong">{t('settings.planning')}</Text>
            <Button
              label={t('planning.upcomingTitle')}
              variant="secondary"
              onPress={() => onNavigate('upcoming')}
              testID="nav-upcoming"
            />
            <Button
              label={t('settings.recurring')}
              variant="secondary"
              onPress={() => onNavigate('recurring')}
              testID="nav-recurring"
            />
            <Button
              label={t('settings.budgets')}
              variant="secondary"
              onPress={() => onNavigate('budgets')}
              testID="nav-budgets"
            />
            <Button
              label={t('settings.goals')}
              variant="secondary"
              onPress={() => onNavigate('goals')}
              testID="nav-goals"
            />
          </Card>
        ) : null}
        {onNavigate ? (
          <Card>
            <Button
              label={t('settings.security')}
              variant="secondary"
              onPress={() => onNavigate('security')}
              testID="nav-security"
            />
            <Button
              label={t('settings.backup')}
              variant="secondary"
              onPress={() => onNavigate('backup')}
              testID="nav-backup"
            />
            <Button
              label={t('settings.data')}
              variant="secondary"
              onPress={() => onNavigate('data')}
              testID="nav-data"
            />
            <Button
              label={t('settings.reset')}
              variant="danger"
              onPress={() => onNavigate('reset')}
              testID="nav-reset"
            />
          </Card>
        ) : null}
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
        <Segmented
          title={t('settings.numberFormat')}
          value={settings.numberFormat}
          options={(Object.keys(NUMBER_FORMATS) as NumberFormatId[]).map((id) => ({
            value: id,
            label: FORMAT_SAMPLES[id],
          }))}
          onSelect={(v) => onChange('numberFormat', v)}
        />
        <Segmented
          title={t('settings.firstDayOfWeek')}
          value={settings.firstDayOfWeek}
          options={([6, 0, 1] as Weekday[]).map((d) => ({
            value: d,
            label: tDynamic(t, `weekdays.long.${d}`),
          }))}
          onSelect={(v) => onChange('firstDayOfWeek', v)}
        />
      </Stack>
    </Screen>
  );
}
