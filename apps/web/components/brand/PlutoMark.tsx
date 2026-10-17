/**
 * Marca da Pluto (monograma "P" com orelhas e moeda em alta). Fonte: design/logo/pluto-monograma-*.svg.
 * A gata (PlutoLogo/PlutoMascot) continua como personagem no chat e nos estados vazios.
 */
export function PlutoMark({ size = 40, tone = 'color' }: { size?: number; tone?: 'color' | 'white' }) {
  const body = tone === 'white' ? '#FFFFFF' : '#7D39EB';
  const coin = tone === 'white' ? '#7D39EB' : '#C6FF33';
  return (
    <svg width={size} height={size} viewBox="20 4 88 110" fill="none" role="img" aria-label="Pluto" style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M26 30 L30 10 Q31.5 6 35 9 L50 24 H64 L80 10 Q84 7 85.5 12 L88 28 C97 34 102 44 102 56 C102 74 88 88 68 88 H52 V104 Q52 110 46 110 H32 Q26 110 26 104 Z"
        fill={body}
      />
      <circle cx="68" cy="56" r="17" fill={coin} />
      <path d="M59 61 L66 53 L71 58 L78 50" stroke={body} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
