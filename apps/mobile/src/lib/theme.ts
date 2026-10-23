import { useColorScheme } from 'react-native';

// Cores do Pluto (mesmos tokens do site), claro e escuro.
const light = {
  brand: '#7D39EB',
  brandSoft: '#EFE6FD',
  accent: '#C6FF33',
  bg: '#F7F7F8',
  card: '#FFFFFF',
  text: '#09090B',
  muted: '#71717A',
  border: '#E4E4E7',
  danger: '#C62828',
  dangerSoft: '#FDECEC',
  onBrand: '#FFFFFF',
};
const dark: typeof light = {
  brand: '#9A68F2',
  brandSoft: '#2A1F45',
  accent: '#C6FF33',
  bg: '#09090B',
  card: '#18181B',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  border: '#27272A',
  danger: '#F87171',
  dangerSoft: '#3B1418',
  onBrand: '#FFFFFF',
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
