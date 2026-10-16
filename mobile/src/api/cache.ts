import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ForecastResponse } from './types';
import { parseForecast } from './validate';

// Last good forecast per (model, horizon), so the screen has something to show
// offline. Forecasts are public market data, so AsyncStorage (unencrypted) is
// appropriate; nothing user-specific is stored here.

const VERSION = 'v1';
const key = (model: string, horizon: number) => `forecast:${VERSION}:${model}:${horizon}`;

export interface CachedForecast {
  data: ForecastResponse;
  savedAt: string; // ISO timestamp when this device received it
}

export async function readCachedForecast(model: string, horizon: number): Promise<CachedForecast | null> {
  const k = key(model, horizon);
  try {
    const raw = await AsyncStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: unknown; savedAt?: unknown };
    if (typeof parsed.savedAt !== 'string') throw new Error('missing savedAt');
    // Re-validate: the entry may predate a schema change or be corrupted.
    return { data: parseForecast(parsed.data, { horizon, model }), savedAt: parsed.savedAt };
  } catch {
    await AsyncStorage.removeItem(k).catch(() => {});
    return null;
  }
}

export async function writeCachedForecast(data: ForecastResponse, now: Date = new Date()): Promise<void> {
  const entry: CachedForecast = { data, savedAt: now.toISOString() };
  try {
    await AsyncStorage.setItem(key(data.model, data.horizon_days), JSON.stringify(entry));
  } catch {
    // Storage full or unavailable: the app still works, just without offline fallback.
  }
}
