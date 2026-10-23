import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

// Texto do app na fonte do site (Geist). No React Native cada peso e uma familia propria.
export const FONTS = {
  400: 'Geist_400Regular',
  500: 'Geist_500Medium',
  600: 'Geist_600SemiBold',
  700: 'Geist_700Bold',
  800: 'Geist_800ExtraBold',
} as const;
export type Weight = keyof typeof FONTS;

type Tone = 'default' | 'muted' | 'brand' | 'danger' | 'inverse';

export function T({
  size = 14,
  weight = 400,
  tone = 'default',
  color,
  style,
  tabular,
  ...rest
}: TextProps & { size?: number; weight?: Weight; tone?: Tone; color?: string; tabular?: boolean }) {
  const t = useTheme();
  const c = color ?? (tone === 'muted' ? t.mutedForeground : tone === 'brand' ? t.brandText : tone === 'danger' ? t.dangerText : tone === 'inverse' ? t.primaryForeground : t.foreground);
  // Letras um pouco mais juntas nos titulos, como no site (letter-spacing negativo).
  const tracking: TextStyle = size >= 20 ? { letterSpacing: -0.03 * size } : size >= 16 ? { letterSpacing: -0.02 * size } : {};
  return <Text {...rest} style={[{ fontFamily: FONTS[weight], fontSize: size, color: c }, tracking, tabular && { fontVariant: ['tabular-nums'] }, style]} />;
}
