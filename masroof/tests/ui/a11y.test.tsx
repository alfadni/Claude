import { render, screen } from '@testing-library/react-native';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import type { ReactElement } from 'react';

import { localDate } from '@/domain';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import { AccountFormScreen } from '@/features/accounts/account-form-screen';
import { AccountsScreen } from '@/features/accounts/accounts-screen';
import { BackupScreen } from '@/features/backup/backup-screen';
import { BudgetFormScreen } from '@/features/budgets/budget-form-screen';
import { BudgetsScreen } from '@/features/budgets/budgets-screen';
import { CategoriesScreen } from '@/features/categories/categories-screen';
import { CsvScreen } from '@/features/data/csv-screen';
import { BaseCurrencyScreen } from '@/features/fx/base-currency-screen';
import { FxRatesScreen } from '@/features/fx/fx-rates-screen';
import { GoalFormScreen } from '@/features/goals/goal-form-screen';
import { GoalsScreen } from '@/features/goals/goals-screen';
import { HomeScreen } from '@/features/home/home-screen';
import { LockScreen } from '@/features/lock/lock-screen';
import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { PrivacyScreen } from '@/features/privacy/privacy-screen';
import { RecurringFormScreen } from '@/features/planning/recurring-form-screen';
import { RecurringListScreen } from '@/features/planning/recurring-list-screen';
import { UpcomingScreen } from '@/features/planning/upcoming-screen';
import { QuickAddScreen } from '@/features/quick-add/quick-add-screen';
import { ReportsScreen } from '@/features/reports/reports-screen';
import { ResetScreen } from '@/features/reset/reset-screen';
import { SecurityScreen } from '@/features/security/security-screen';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { TransactionDetailScreen } from '@/features/transactions/detail-screen';
import { TransactionsListScreen } from '@/features/transactions/list-screen';
import { TrashScreen } from '@/features/transactions/trash-screen';
import { createI18n } from '@/i18n';

import { must, type Ledger } from '../helpers/ledger';
import { createTestSession, renderWithSession, type TestSession } from './ledger-session';

jest.mock('@react-native-community/datetimepicker', () => () => null);

/**
 * Phase 5 accessibility audit, automated (docs/ACCESSIBILITY.md). Every
 * screen is rendered with realistic data in English and Arabic and checked:
 * - every interactive element has a role and a non-empty accessible name;
 * - every text input has a label;
 * - every image has a label;
 * - no text opts out of Dynamic Type.
 */

const noop = () => undefined;

type Node = NonNullable<typeof screen.root>;

function textOf(node: Node | string): string {
  if (typeof node === 'string') return node;
  return node.children.map((c) => textOf(c)).join('');
}

function describeNode(n: Node): string {
  const p = n.props as Record<string, unknown>;
  return `${String(n.type)}#${String(p.testID ?? '?')} "${textOf(n).slice(0, 30)}"`;
}

function audit(root: Node | null): string[] {
  if (!root) return ['nothing rendered'];
  const problems: string[] = [];
  for (const n of root.queryAll(() => true)) {
    const p = n.props as Record<string, unknown>;
    if (
      p.accessibilityElementsHidden === true ||
      p.importantForAccessibility === 'no-hide-descendants'
    ) {
      continue;
    }
    const interactive =
      typeof p.onClick === 'function' || typeof p.onResponderRelease === 'function';
    if (interactive && n.type !== 'RCTScrollView' && n.type !== 'TextInput') {
      const role = p.accessibilityRole ?? p.role;
      const name = String(p.accessibilityLabel ?? '').trim() || textOf(n).trim();
      if (!role) problems.push(`no role: ${describeNode(n)}`);
      if (!name) problems.push(`no name: ${describeNode(n)}`);
    }
    if (n.type === 'TextInput' && !String(p.accessibilityLabel ?? '').trim()) {
      problems.push(`unlabelled input: ${describeNode(n)}`);
    }
    if (
      n.type === 'Image' &&
      !String(p.accessibilityLabel ?? '').trim() &&
      p.accessible !== false
    ) {
      problems.push(`unlabelled image: ${describeNode(n)}`);
    }
    if (n.type === 'Text' && p.allowFontScaling === false) {
      problems.push(`no Dynamic Type: ${describeNode(n)}`);
    }
  }
  return problems;
}

/** A ledger with something on every screen: transactions, rule, budget, goal, rates. */
function populated(locale: 'en' | 'ar'): { ts: TestSession; ids: Record<string, string> } {
  const ts = createTestSession({ locale });
  const l: Ledger = ts.ledger;
  const tx = must(
    l.repos.transactions.create(
      l.expense({ occurredOn: localDate('2026-10-01'), payeeName: 'Landlord', note: 'Rent' }),
    ),
  );
  must(l.repos.transactions.create(l.income({ amountMinor: 300000 })));
  const deleted = must(l.repos.transactions.create(l.expense({ amountMinor: 99 })));
  must(l.repos.transactions.delete(deleted.id));
  const rule = must(
    l.repos.recurring.createFromTransaction(tx.id, {
      pattern: { frequency: 'monthly', interval: 1, byMonthDay: 1 },
      mode: 'confirm_before_post',
    }),
  );
  const budget = must(
    l.repos.budgets.create({
      categoryId: l.ids.food,
      period: 'monthly',
      amountMinor: 1000,
      rollover: false,
      thresholds: [80],
    }),
  );
  const goal = must(
    l.repos.goals.create({
      name: 'Car',
      targetMinor: 1000000,
      targetDate: null,
      linkedAccountId: l.ids.bank,
    }),
  );
  l.repos.fx.record('EUR', 'USD', '1.1' as never, localDate('2026-10-01'));
  return {
    ts,
    ids: { tx: tx.id, rule: rule.id, budget: budget.id, goal: goal.id, account: l.ids.cash },
  };
}

const device = {
  locale: 'en' as const,
  baseCurrency: 'USD' as const,
  firstDayOfWeek: 1 as const,
  timeZone: 'Africa/Khartoum',
};

const screens: [string, (ids: Record<string, string>) => ReactElement][] = [
  [
    'home',
    () => (
      <HomeScreen
        nav={{
          onAdd: noop,
          onDay: noop,
          onCategory: noop,
          onAllTransactions: noop,
          onSettings: noop,
          onAccounts: noop,
          onBackup: noop,
          onUpcoming: noop,
          onBudgets: noop,
        }}
      />
    ),
  ],
  ['quick add', () => <QuickAddScreen onDone={noop} onCancel={noop} />],
  ['quick add (edit)', (ids) => <QuickAddScreen editId={ids.tx} onDone={noop} onCancel={noop} />],
  ['transactions', () => <TransactionsListScreen params={{}} onOpen={noop} />],
  [
    'detail',
    (ids) => (
      <TransactionDetailScreen
        id={ids.tx as string}
        onEdit={noop}
        onDeleted={noop}
        onRepeat={noop}
        onOpenRule={noop}
      />
    ),
  ],
  ['trash', () => <TrashScreen />],
  ['accounts', () => <AccountsScreen onOpen={noop} onAdd={noop} />],
  ['account form', (ids) => <AccountFormScreen id={ids.account as string} onDone={noop} />],
  ['categories', () => <CategoriesScreen />],
  [
    'settings',
    () => (
      <SettingsScreen
        settings={DEFAULT_SETTINGS}
        restartRequired={false}
        onChange={noop}
        onRestart={noop}
        onNavigate={noop}
        t={createI18n('en').t}
      />
    ),
  ],
  ['security', () => <SecurityScreen onBackup={noop} />],
  ['backup', () => <BackupScreen />],
  ['csv', () => <CsvScreen />],
  [
    'reset',
    () => <ResetScreen reset={async () => 'done'} onBackup={noop} onDone={noop} onCancel={noop} />,
  ],
  ['lock', () => <LockScreen onUnlocked={noop} onReset={noop} />],
  [
    'onboarding',
    () => <OnboardingScreen device={device} onLanguageChosen={noop} onFinished={noop} />,
  ],
  ['upcoming', () => <UpcomingScreen onOpenRule={noop} onManageRules={noop} />],
  ['recurring list', () => <RecurringListScreen onOpen={noop} />],
  [
    'rule form',
    (ids) => <RecurringFormScreen ruleId={ids.rule as string} transactionId={null} onDone={noop} />,
  ],
  ['budgets', () => <BudgetsScreen onOpen={noop} onAdd={noop} />],
  ['budget form', (ids) => <BudgetFormScreen id={ids.budget as string} onDone={noop} />],
  ['goals', () => <GoalsScreen onOpen={noop} onAdd={noop} />],
  ['goal form', (ids) => <GoalFormScreen id={ids.goal as string} onDone={noop} />],
  ['reports', () => <ReportsScreen />],
  ['fx rates', () => <FxRatesScreen />],
  ['privacy', () => <PrivacyScreen />],
  ['main currency', () => <BaseCurrencyScreen onBackup={noop} onDone={noop} />],
];

describe.each(['en', 'ar'] as const)('accessibility audit (%s)', (locale) => {
  it.each(screens)('%s', async (_name, make) => {
    const { ts, ids } = populated(locale);
    await renderWithSession(make(ids), ts, locale);
    expect(audit(screen.root)).toEqual([]);
  });
});

describe('the audit itself catches violations', () => {
  it('flags unnamed / role-less controls, unlabelled inputs and images, fixed-size text', async () => {
    await render(
      <View>
        <Pressable onPress={noop} testID="bare">
          <View />
        </Pressable>
        <Pressable onPress={noop} accessibilityRole="button" testID="named">
          <Text>Save</Text>
        </Pressable>
        <TextInput testID="input" />
        <Image source={{ uri: 'x' }} testID="img" />
        <Text allowFontScaling={false}>tiny</Text>
      </View>,
    );
    const problems = audit(screen.root);
    expect(problems).toEqual([
      expect.stringMatching(/^no role: .*#bare/),
      expect.stringMatching(/^no name: .*#bare/),
      expect.stringMatching(/^unlabelled input: .*#input/),
      expect.stringMatching(/^unlabelled image: .*#img/),
      expect.stringMatching(/^no Dynamic Type: /),
    ]);
  });
});
