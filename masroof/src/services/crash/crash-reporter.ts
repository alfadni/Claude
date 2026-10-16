import { scrubEvent } from './scrub';

/** Opt-in crash reporting (ADR-017). Off unless the build has a DSN and the user opts in. */
export interface CrashReporter {
  /** False when this build has no DSN: the setting is hidden. */
  readonly available: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const noCrashReporter: CrashReporter = {
  available: false,
  start: async () => undefined,
  stop: async () => undefined,
};

type SentryLike = {
  init(options: Record<string, unknown>): void;
  close(): Promise<unknown> | unknown;
};

/** Options that keep a report to stack traces only; exported for tests. */
export function sentryOptions(dsn: string, release: string): Record<string, unknown> {
  return {
    dsn,
    release,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    attachScreenshot: false,
    attachViewHierarchy: false,
    attachStacktrace: true,
    enableAutoSessionTracking: false,
    tracesSampleRate: 0,
    beforeSend: (event: unknown) => scrubEvent(event),
  };
}

/**
 * Sentry adapter. The SDK is loaded lazily, so builds and sessions that never
 * opt in never load it.
 */
export function createSentryReporter(params: {
  dsn: string | undefined;
  release: string;
  load: () => Promise<SentryLike>;
}): CrashReporter {
  const { dsn } = params;
  if (!dsn) return noCrashReporter;
  let sentry: SentryLike | null = null;
  return {
    available: true,
    async start() {
      if (sentry) return;
      try {
        const s = await params.load();
        s.init(sentryOptions(dsn, params.release));
        sentry = s;
      } catch {
        // Crash reporting must never break the app.
      }
    },
    async stop() {
      const s = sentry;
      sentry = null;
      try {
        await s?.close();
      } catch {
        // ignore
      }
    },
  };
}
