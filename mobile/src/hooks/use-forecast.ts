import { useCallback, useEffect, useState } from 'react';

import { readCachedForecast, writeCachedForecast } from '@/api/cache';
import { ForecastError, fetchForecast } from '@/api/client';
import type { ForecastResponse, ModelName } from '@/api/types';

type Ready = {
  status: 'ready';
  data: ForecastResponse;
  /** 'cache' = saved on this device earlier, not confirmed by the server just now. */
  source: 'network' | 'cache';
  savedAt?: string;
  refreshing: boolean;
  /** Set when a refresh failed and older data is being shown instead. */
  error?: ForecastError;
};

export type ForecastState = { status: 'loading' } | { status: 'error'; error: ForecastError } | Ready;

/** A settled or partial result, tagged with the request it answers. */
type Result = {
  key: string; // model:horizon
  attempt: number; // the attempt that completed it; -1 while only a cached copy is shown
  state: Exclude<ForecastState, { status: 'loading' }>;
};

function toForecastError(e: unknown): ForecastError {
  return e instanceof ForecastError
    ? e
    : new ForecastError('server', e instanceof Error ? e.message : String(e));
}

/**
 * Forecast for one (model, horizon): saved copy first if there is one, then
 * the network. Switching horizon aborts the in-flight request, and every
 * result is tagged with the request it answers, so a slow answer for an old
 * horizon can never overwrite the current one.
 */
export function useForecast(horizon: number, model: ModelName = 'ensemble') {
  const key = `${model}:${horizon}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const cached = await readCachedForecast(model, horizon);
      if (cancelled) return;
      if (cached) {
        // Only fill an empty screen; never replace data already shown for this key.
        setResult((prev) =>
          prev?.key === key && prev.state.status === 'ready'
            ? prev
            : {
                key,
                attempt: -1,
                state: {
                  status: 'ready',
                  data: cached.data,
                  source: 'cache',
                  savedAt: cached.savedAt,
                  refreshing: false,
                },
              },
        );
      }
      try {
        const data = await fetchForecast({ horizon, model, signal: controller.signal });
        if (cancelled) return;
        setResult({ key, attempt, state: { status: 'ready', data, source: 'network', refreshing: false } });
        void writeCachedForecast(data);
      } catch (e) {
        if (cancelled) return;
        const error = toForecastError(e);
        setResult((prev) =>
          prev?.key === key && prev.state.status === 'ready'
            ? { key, attempt, state: { ...prev.state, error } }
            : { key, attempt, state: { status: 'error', error } },
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, horizon, model, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  let state: ForecastState;
  if (!result || result.key !== key) {
    state = { status: 'loading' };
  } else if (result.attempt !== attempt) {
    // Current request still in flight: keep showing what we have.
    state =
      result.state.status === 'ready'
        ? { ...result.state, refreshing: true, error: undefined }
        : { status: 'loading' };
  } else {
    state = result.state;
  }
  return { state, reload };
}
