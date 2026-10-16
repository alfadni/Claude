import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  border: '#E3E6EB',
  text: '#11151C',
  textMuted: '#5B6573',
  accent: '#1F6FEB',
  bandInner: 'rgba(31, 111, 235, 0.28)',
  bandOuter: 'rgba(31, 111, 235, 0.12)',
  grid: '#E9ECF0',
  positive: '#1A7F37',
  negative: '#C62828',
  infoBg: '#EAF2FF',
  infoText: '#123E7C',
  warnBg: '#FFF5DB',
  warnText: '#6B4A00',
  errorBg: '#FDECEC',
  errorText: '#8A1C1C',
};

export type Palette = typeof light;

const dark: Palette = {
  background: '#0D1117',
  surface: '#161B22',
  border: '#2A313C',
  text: '#E6EAF0',
  textMuted: '#9AA4B2',
  accent: '#5B9DFF',
  bandInner: 'rgba(91, 157, 255, 0.32)',
  bandOuter: 'rgba(91, 157, 255, 0.14)',
  grid: '#222934',
  positive: '#4AC26B',
  negative: '#FF7B72',
  infoBg: '#10243F',
  infoText: '#B8D4FF',
  warnBg: '#3A2D0A',
  warnText: '#F5D88A',
  errorBg: '#3D1517',
  errorText: '#FFB4AE',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
