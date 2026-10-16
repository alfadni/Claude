import type { TFunction } from 'i18next';

import { parts, type RecurrenceSchedule } from '@/domain';

import { tDynamic, type Formatter } from '../session/use-format';

/** "Every 1 month(s) on day 31" etc., in the UI language and digits. */
export function scheduleText(t: TFunction, f: Formatter, s: RecurrenceSchedule): string {
  const p = s.pattern;
  const n = f.digits(p.interval);
  switch (p.frequency) {
    case 'daily':
      return t('planning.schedule_daily', { n });
    case 'weekly': {
      const days = (p.byWeekday && p.byWeekday.length > 0 ? p.byWeekday : [])
        .map((d) => tDynamic(t, `weekdays.short.${d}`))
        .join(t('common.listSeparator'));
      return t('planning.schedule_weekly', { n, days });
    }
    case 'monthly': {
      const day = p.byMonthDay ?? parts(s.startsOn).day;
      return day === -1
        ? t('planning.schedule_monthly_last', { n })
        : t('planning.schedule_monthly', { n, day: f.digits(day) });
    }
    case 'yearly': {
      const { month, day } = parts(s.startsOn);
      return t('planning.schedule_yearly', {
        n,
        date: `${f.digits(day)} ${tDynamic(t, `months.${month}`)}`,
      });
    }
  }
}
