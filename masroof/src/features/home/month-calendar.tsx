import { Pressable, View } from 'react-native';

import {
  calendarGrid,
  money,
  parts,
  type CurrencyCode,
  type LocalDate,
  type Period,
  type Weekday,
} from '@/domain';
import type { DaySummary } from '@/data/repositories/reports-repository';
import { MIN_TOUCH_TARGET, radius, spacing, Text, useTheme } from '@/ui';

import { tDynamic, type Formatter } from '../session/use-format';

/**
 * The baseline's month calendar (its strongest feature). Each day shows ▲ for
 * income and ▼ for expense, so the marker is not colour-only, and screen readers
 * get the day's totals as a sentence.
 */
export function MonthCalendar({
  month,
  firstDayOfWeek,
  days,
  today,
  currency,
  f,
  onDayPress,
}: {
  month: Period;
  firstDayOfWeek: Weekday;
  days: readonly DaySummary[];
  today: LocalDate;
  currency: CurrencyCode;
  f: Formatter;
  onDayPress: (d: LocalDate) => void;
}) {
  const { colors } = useTheme();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const grid = calendarGrid(month, firstDayOfWeek);
  const weekdayOrder = Array.from({ length: 7 }, (_, i) => ((firstDayOfWeek + i) % 7) as Weekday);

  return (
    <View testID="month-calendar" style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants">
        {weekdayOrder.map((w) => (
          <Text key={w} variant="caption" tone="muted" style={{ flex: 1, textAlign: 'center' }}>
            {tDynamic(f.t, `weekdays.short.${w}`)}
          </Text>
        ))}
      </View>
      {grid.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row', gap: 2 }}>
          {week.map((cell) => {
            const s = byDate.get(cell.date);
            const isToday = cell.date === today;
            const { day } = parts(cell.date);
            const label = s
              ? f.t('home.dayLabel', {
                  date: f.date(cell.date),
                  income: f.money(money(s.incomeMinor, currency)),
                  expense: f.money(money(s.expenseMinor, currency)),
                })
              : f.t('home.dayLabelEmpty', { date: f.date(cell.date) });
            return (
              <Pressable
                key={cell.date}
                testID={`day-${cell.date}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: isToday }}
                onPress={() => onDayPress(cell.date)}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: MIN_TOUCH_TARGET + 4,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.sm,
                  borderWidth: isToday ? 2 : 0,
                  borderColor: colors.primary,
                  backgroundColor: cell.inMonth ? colors.surface : 'transparent',
                  opacity: pressed ? 0.7 : cell.inMonth ? 1 : 0.45,
                })}
              >
                <Text variant={isToday ? 'bodyStrong' : 'body'}>{f.digits(day)}</Text>
                <View style={{ flexDirection: 'row', gap: 2, minHeight: 14 }}>
                  {s && s.incomeMinor > 0 ? (
                    <Text variant="caption" tone="income" testID={`income-marker-${cell.date}`}>
                      ▲
                    </Text>
                  ) : null}
                  {s && s.expenseMinor > 0 ? (
                    <Text variant="caption" tone="expense" testID={`expense-marker-${cell.date}`}>
                      ▼
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
