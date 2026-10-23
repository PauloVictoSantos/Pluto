import { ICON_PATHS } from '@pluto/shared';
import type { CSSProperties } from 'react';

// Conjunto de icones do design: os tracos ficam em @pluto/shared (mesmos no app).

export function Icon({
  icon,
  size = '1em',
  className,
  style,
}: {
  icon: string;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  const paths = ICON_PATHS[icon.replace(/^icon-/, '')] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
