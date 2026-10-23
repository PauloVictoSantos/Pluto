import { ICON_PATHS } from '@pluto/shared';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

/** Icones do design: os mesmos tracos do site (@pluto/shared), estilo Lucide 24x24. */
export function Icon({ icon, size = 20, color }: { icon: string; size?: number; color?: string }) {
  const t = useTheme();
  const paths = ICON_PATHS[icon.replace(/^icon-/, '')] ?? [];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? t.foreground} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => (
        <Path key={i} d={d} />
      ))}
    </Svg>
  );
}
