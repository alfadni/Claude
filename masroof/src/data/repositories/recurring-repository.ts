import { and, eq, isNull } from 'drizzle-orm';

import {
  addDays,
  err,
  firstOccurrence,
  formatRRule,
  nextOccurrenceAfter,
  ok,
  parseRRule,
  parseTemplate,
  templateFromInput,
  validateSchedule,
  type LocalDate,
  type RecurrenceError,
  type RecurrencePattern,
  type RecurrenceSchedule,
  type RecurringMode,
  type RecurringTemplate,
  type Result,
} from '@/domain';

import type { DataDeps } from '../database';
import { recurringRules, transactions } from '../schema';
import { withUnitOfWork } from '../unit-of-work';
import { inputFromDetail, type TransactionsRepository } from './transactions-repository';

export type RuleRow = typeof recurringRules.$inferSelect;

export type Rule = Readonly<{
  row: RuleRow;
  id: string;
  mode: RecurringMode;
  schedule: RecurrenceSchedule;
  template: RecurringTemplate;
  timeZone: string;
  isPaused: boolean;
  /** First occurrence not generated yet (null = finished). */
  nextOn: LocalDate | null;
  occurrenceCount: number;
  lastError: string | null;
}>;

export type RuleSettings = Readonly<{
  pattern: RecurrencePattern;
  mode: RecurringMode;
  startsOn?: LocalDate;
  endsOn?: LocalDate | null;
  maxOccurrences?: number | null;
}>;

export type RuleError =
  RecurrenceError | 'not_found' | 'transaction_not_eligible' | 'start_before_transaction';

/** Rows that can't be parsed (corrupt restore) are reported, never guessed at. */
function toRule(row: RuleRow): Rule | null {
  const pattern = parseRRule(row.rrule);
  const template = parseTemplate(row.templateJson);
  if (!pattern.ok || !template.ok) return null;
  return {
    row,
    id: row.id,
    mode: row.mode,
    schedule: {
      pattern: pattern.value,
      startsOn: row.startsOn as LocalDate,
      endsOn: (row.endsOn as LocalDate | null) ?? null,
      maxOccurrences: row.maxOccurrences ?? null,
    },
    template: template.value,
    timeZone: row.tz,
    isPaused: row.isPaused,
    nextOn: (row.nextOccurrenceOn as LocalDate | null) ?? null,
    occurrenceCount: row.occurrenceCount,
    lastError: row.lastError,
  };
}

export function createRecurringRepository(
  deps: DataDeps & {
    today: () => LocalDate;
    transactions: TransactionsRepository;
  },
) {
  const { db } = deps;
  const getRow = (id: string) =>
    db.select().from(recurringRules).where(eq(recurringRules.id, id)).get();

  /** Latest occurrence date already generated for a rule, if any. */
  function lastGenerated(ruleId: string): LocalDate | null {
    const r = deps.sql.all<{ d: string | null }>(
      'SELECT max(occurred_on) AS d FROM transactions WHERE recurring_rule_id = ? AND recurrence_key IS NOT NULL',
      [ruleId],
    )[0];
    return (r?.d as LocalDate | null) ?? null;
  }

  function write(before: RuleRow, patch: Partial<RuleRow>): RuleRow {
    return withUnitOfWork(deps, ({ tx, now, audit }) => {
      const after: RuleRow = { ...before, ...patch, updatedAt: now, version: before.version + 1 };
      tx.update(recurringRules).set(after).where(eq(recurringRules.id, before.id)).run();
      audit({ entity: 'recurring_rules', entityId: before.id, action: 'update', before, after });
      return after;
    });
  }

  const api = {
    get(id: string): Rule | null {
      const row = getRow(id);
      return row && row.deletedAt === null ? toRule(row) : null;
    },

    /** Live rules; unreadable rows are returned separately so the UI can flag them. */
    list(): { rules: Rule[]; unreadableIds: string[] } {
      const rows = db.select().from(recurringRules).where(isNull(recurringRules.deletedAt)).all();
      const rules: Rule[] = [];
      const unreadableIds: string[] = [];
      for (const row of rows) {
        const r = toRule(row);
        if (r) rules.push(r);
        else unreadableIds.push(row.id);
      }
      rules.sort((a, b) => (a.nextOn ?? '9999').localeCompare(b.nextOn ?? '9999'));
      return { rules, unreadableIds };
    },

    /**
     * "Repeat…" on an existing transaction (ADR-013). If the schedule's first
     * occurrence is that transaction's date, the transaction becomes
     * occurrence #1, so this month is never recorded twice.
     */
    createFromTransaction(txId: string, settings: RuleSettings): Result<Rule, RuleError[]> {
      const tx = deps.transactions.get(txId);
      if (!tx || tx.deletedAt !== null || tx.status !== 'posted' || tx.recurringRuleId !== null) {
        return err(['transaction_not_eligible']);
      }
      const txDate = tx.occurredOn as LocalDate;
      const startsOn = settings.startsOn ?? txDate;
      if (startsOn < txDate) return err(['start_before_transaction']);
      const schedule: RecurrenceSchedule = {
        pattern: settings.pattern,
        startsOn,
        endsOn: settings.endsOn ?? null,
        maxOccurrences: settings.maxOccurrences ?? null,
      };
      const errors = validateSchedule(schedule);
      if (errors.length > 0) return err(errors);

      const first = firstOccurrence(schedule);
      const linkFirst = first === txDate;
      const template = templateFromInput(inputFromDetail(tx));
      return withUnitOfWork(deps, ({ tx: dbTx, now, newId, audit }) => {
        const id = newId();
        const count = linkFirst ? 1 : 0;
        const nextOn = linkFirst ? nextOccurrenceAfter(schedule, txDate, count) : first;
        const row: RuleRow = {
          id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1,
          rrule: formatRRule(settings.pattern),
          tz: tx.occurredTz,
          templateJson: JSON.stringify(template),
          mode: settings.mode,
          startsOn,
          endsOn: schedule.endsOn ?? null,
          maxOccurrences: schedule.maxOccurrences ?? null,
          nextRunAt: null,
          lastRunAt: null,
          isPaused: false,
          nextOccurrenceOn: nextOn,
          occurrenceCount: count,
          lastError: null,
        };
        dbTx.insert(recurringRules).values(row).run();
        audit({ entity: 'recurring_rules', entityId: id, action: 'create', after: row });
        if (linkFirst) deps.transactions.linkToRule(txId, id, txDate);
        return ok(toRule(row) as Rule);
      });
    },

    /**
     * Change schedule or mode. Already generated rows are never touched; the
     * cursor continues after the last generated occurrence.
     */
    updateSettings(id: string, settings: RuleSettings): Result<Rule, RuleError[]> {
      const before = getRow(id);
      if (!before || before.deletedAt !== null) return err(['not_found']);
      const schedule: RecurrenceSchedule = {
        pattern: settings.pattern,
        startsOn: settings.startsOn ?? (before.startsOn as LocalDate),
        endsOn: settings.endsOn ?? null,
        maxOccurrences: settings.maxOccurrences ?? null,
      };
      const errors = validateSchedule(schedule);
      if (errors.length > 0) return err(errors);
      const last = lastGenerated(id);
      const nextOn = last
        ? nextOccurrenceAfter(schedule, last, before.occurrenceCount)
        : firstOccurrence(schedule);
      const after = write(before, {
        rrule: formatRRule(settings.pattern),
        mode: settings.mode,
        startsOn: schedule.startsOn,
        endsOn: schedule.endsOn ?? null,
        maxOccurrences: schedule.maxOccurrences ?? null,
        nextOccurrenceOn: before.isPaused ? before.nextOccurrenceOn : nextOn,
        lastError: null,
      });
      return ok(toRule(after) as Rule);
    },

    /**
     * Pause / resume. Resuming continues from today: occurrences that fell
     * inside the pause are not back-filled (the user asked for none).
     */
    setPaused(id: string, paused: boolean): boolean {
      const before = getRow(id);
      if (!before || before.deletedAt !== null || before.isPaused === paused) return false;
      const rule = toRule(before);
      let nextOn = before.nextOccurrenceOn;
      if (!paused && rule) {
        const fromToday = nextOccurrenceAfter(
          rule.schedule,
          addDays(deps.today(), -1),
          rule.occurrenceCount,
        );
        const last = lastGenerated(id);
        nextOn =
          last && fromToday && fromToday <= last
            ? nextOccurrenceAfter(rule.schedule, last, rule.occurrenceCount)
            : fromToday;
      }
      write(before, { isPaused: paused, nextOccurrenceOn: nextOn, lastError: null });
      return true;
    },

    /** Soft-delete the rule and void its pending occurrences; posted rows stay. */
    delete(id: string): boolean {
      const before = getRow(id);
      if (!before || before.deletedAt !== null) return false;
      withUnitOfWork(deps, ({ tx, now, audit }) => {
        tx.update(recurringRules)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(recurringRules.id, id))
          .run();
        audit({ entity: 'recurring_rules', entityId: id, action: 'delete', before });
        const pending = tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.recurringRuleId, id),
              eq(transactions.status, 'pending_recurring'),
              isNull(transactions.deletedAt),
            ),
          )
          .all();
        for (const p of pending) deps.transactions.skipPending(p.id);
      });
      return true;
    },

    /** Engine bookkeeping: advance the cursor (in the caller's unit of work). */
    advance(id: string, patch: { nextOn: LocalDate | null; generated: number; at: number }) {
      const before = getRow(id);
      if (!before) return;
      write(before, {
        nextOccurrenceOn: patch.nextOn,
        occurrenceCount: before.occurrenceCount + patch.generated,
        lastRunAt: patch.at,
        lastError: null,
      });
    },

    /** Engine bookkeeping: the rule could not post; the cursor stays put. */
    setError(id: string, error: string | null) {
      const before = getRow(id);
      if (!before || before.lastError === error) return;
      write(before, { lastError: error });
    },
  };
  return api;
}

export type RecurringRepository = ReturnType<typeof createRecurringRepository>;
