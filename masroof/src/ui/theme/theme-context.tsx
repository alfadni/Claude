import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import type { ThemePreference } from '@/domain/settings';

import { palettes, type ColorScheme, type Palette } from '../tokens';

type Theme = Readonly<{ scheme: ColorScheme; colors: Palette }>;

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: palettes.light });

export function resolveScheme(
  pref: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const scheme = resolveScheme(preference, system);
  const value = useMemo(() => ({ scheme, colors: palettes[scheme] }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);
