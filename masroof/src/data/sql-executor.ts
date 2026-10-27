/**
 * The minimal synchronous SQL surface the data layer needs from a driver.
 * Implemented for expo-sqlite (device) and better-sqlite3 (tests), so the
 * migration runner and integrity checks run identically in both.
 */
export type SqlValue = string | number | null;

export interface SqlExecutor {
  /** Run one or more statements with no parameters. */
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  /** Run `fn` atomically; any throw rolls everything back. */
  transaction<T>(fn: () => T): T;
}
