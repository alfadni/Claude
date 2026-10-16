/**
 * Design tokens. Every text/background pair used in the app is listed in
 * CONTRAST_PAIRS and verified ≥ 4.5:1 (WCAG AA) by tests/node/ui/tokens.test.ts.
 *
 * Income/expense keep the baseline's green/red, but colour is never the only
 * signal: amounts always carry a plus/minus sign and an icon (spec §9).
 */
export type ColorScheme = 'light' | 'dark';

export type Palette = Readonly<{
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  income: string;
  expense: string;
  transfer: string;
  warning: string;
  danger: string;
  onDanger: string;
  focus: string;
}>;

export const palettes: Readonly<Record<ColorScheme, Palette>> = {
  light: {
    background: '#F7F8FA',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    border: '#D5D9E0',
    text: '#111827',
    textMuted: '#4B5563',
    primary: '#0F766E',
    onPrimary: '#FFFFFF',
    income: '#047857',
    expense: '#B91C1C',
    transfer: '#1D4ED8',
    warning: '#92400E',
    danger: '#B91C1C',
    onDanger: '#FFFFFF',
    focus: '#2563EB',
  },
  dark: {
    background: '#0B0F14',
    surface: '#151B23',
    surfaceRaised: '#1E2631',
    border: '#334155',
    text: '#F3F4F6',
    textMuted: '#AAB3C0',
    primary: '#2DD4BF',
    onPrimary: '#042F2E',
    income: '#34D399',
    expense: '#F87171',
    transfer: '#93C5FD',
    warning: '#FBBF24',
    danger: '#F87171',
    onDanger: '#1F0A0A',
    focus: '#93C5FD',
  },
};

/** [foreground, background] pairs that must meet 4.5:1 in both schemes. */
export const CONTRAST_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceRaised'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceRaised'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['onPrimary', 'primary'],
  ['income', 'surface'],
  ['income', 'background'],
  ['expense', 'surface'],
  ['expense', 'background'],
  ['transfer', 'surface'],
  ['warning', 'surface'],
  ['danger', 'surface'],
  ['onDanger', 'danger'],
];

/** 4-pt spacing scale. */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/**
 * Base font sizes. Components never disable font scaling (Dynamic Type), and
 * layouts must tolerate 200% text.
 */
export const typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
} as const;

/** Minimum touch target (iOS HIG 44pt, Material 48dp → use 48). */
export const MIN_TOUCH_TARGET = 48;

// ---------------------------------------------------------------------------
// WCAG contrast maths (exported for tests and runtime checks of user colours)
// ---------------------------------------------------------------------------

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Expected #RRGGBB, got ${hex}`);
  const n = parseInt(m[1] as string, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
