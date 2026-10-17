/** Cabeca da Pluto (logo estatico). */
export function PlutoLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="58 18 84 88" fill="none" role="img" aria-label="Pluto, a gata" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M69 64 L72 24 Q73.5 21 76 23.5 L97 46 Z" fill="#7D39EB" />
      <path d="M75 52 L76.5 31 L89 45 Z" fill="#B18CF7" />
      <path d="M131 64 L128 24 Q126.5 21 124 23.5 L103 46 Z" fill="#7D39EB" />
      <path d="M125 52 L123.5 31 L111 45 Z" fill="#B18CF7" />
      <path d="M66 74 C66 52 82 42 100 42 C118 42 134 52 134 74 C134 92 119 102 100 102 C81 102 66 92 66 74 Z" fill="#7D39EB" />
      <ellipse cx="94.5" cy="89" rx="6.5" ry="4.6" fill="#9A68F2" />
      <ellipse cx="105.5" cy="89" rx="6.5" ry="4.6" fill="#9A68F2" />
      <path d="M76 73 Q85 65.5 95 71.5 Q86 80 76 73 Z" fill="#C6FF33" />
      <path d="M124 73 Q115 65.5 105 71.5 Q114 80 124 73 Z" fill="#C6FF33" />
      <ellipse cx="86" cy="73" rx="1.9" ry="4.6" fill="#000000" />
      <ellipse cx="114" cy="73" rx="1.9" ry="4.6" fill="#000000" />
      <path d="M75.5 72.6 Q85 65 95.5 71 M124.5 72.6 Q115 65 104.5 71" fill="none" stroke="#2A0E5C" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M79 64.5 L93 67.6 M121 64.5 L107 67.6" fill="none" stroke="#5A22B8" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M96.6 84 L103.4 84 L100 87.6 Z" fill="#2A0E5C" />
      <path d="M100 87.6 L100 90 M96.2 91.6 Q98.2 91.2 100 90 Q101.8 91.2 103.8 91.6" fill="none" stroke="#2A0E5C" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}
