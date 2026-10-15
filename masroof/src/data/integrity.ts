import type { SqlExecutor } from './sql-executor';

/**
 * Cross-row invariants SQLite constraints cannot express. Returns counts only,
 * never amounts or notes, so the report is safe to surface in diagnostics.
 */
export type IntegrityReport = Readonly<{
  splitSumMismatches: number;
  nonTransferWithoutSplits: number;
  transfersWithSplits: number;
  foreignKeyViolations: number;
  ok: boolean;
}>;

const count = (sql: SqlExecutor, query: string): number => sql.all<{ n: number }>(query)[0]?.n ?? 0;

export function integrityReport(sql: SqlExecutor): IntegrityReport {
  const splitSumMismatches = count(
    sql,
    `SELECT count(*) AS n FROM transactions t
     WHERE t.deleted_at IS NULL AND t.type <> 'transfer'
       AND t.amount_minor <> (SELECT coalesce(sum(s.amount_minor), 0) FROM transaction_splits s
                              WHERE s.transaction_id = t.id AND s.deleted_at IS NULL)`,
  );
  const nonTransferWithoutSplits = count(
    sql,
    `SELECT count(*) AS n FROM transactions t
     WHERE t.deleted_at IS NULL AND t.type <> 'transfer'
       AND NOT EXISTS (SELECT 1 FROM transaction_splits s
                       WHERE s.transaction_id = t.id AND s.deleted_at IS NULL)`,
  );
  const transfersWithSplits = count(
    sql,
    `SELECT count(*) AS n FROM transactions t
     WHERE t.type = 'transfer'
       AND EXISTS (SELECT 1 FROM transaction_splits s
                   WHERE s.transaction_id = t.id AND s.deleted_at IS NULL)`,
  );
  const foreignKeyViolations = sql.all('PRAGMA foreign_key_check').length;

  return {
    splitSumMismatches,
    nonTransferWithoutSplits,
    transfersWithSplits,
    foreignKeyViolations,
    ok:
      splitSumMismatches === 0 &&
      nonTransferWithoutSplits === 0 &&
      transfersWithSplits === 0 &&
      foreignKeyViolations === 0,
  };
}
