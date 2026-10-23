import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

// Marcas do Pluto (mesmos desenhos de apps/web/components/brand).

/** Monograma "P" com orelhas e moeda em alta (cabecalho). */
export function PlutoMark({ size = 32, tone = 'color' }: { size?: number; tone?: 'color' | 'white' }) {
  const body = tone === 'white' ? '#FFFFFF' : '#7D39EB';
  const coin = tone === 'white' ? '#7D39EB' : '#C6FF33';
  return (
    <Svg width={size} height={size} viewBox="20 4 88 110" fill="none">
      <Path d="M26 30 L30 10 Q31.5 6 35 9 L50 24 H64 L80 10 Q84 7 85.5 12 L88 28 C97 34 102 44 102 56 C102 74 88 88 68 88 H52 V104 Q52 110 46 110 H32 Q26 110 26 104 Z" fill={body} />
      <Circle cx="68" cy="56" r="17" fill={coin} />
      <Path d="M59 61 L66 53 L71 58 L78 50" stroke={body} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A gata (personagem do chat e dos estados vazios). */
export function PlutoLogo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="58 18 84 88" fill="none">
      <Path d="M69 64 L72 24 Q73.5 21 76 23.5 L97 46 Z" fill="#7D39EB" />
      <Path d="M75 52 L76.5 31 L89 45 Z" fill="#B18CF7" />
      <Path d="M131 64 L128 24 Q126.5 21 124 23.5 L103 46 Z" fill="#7D39EB" />
      <Path d="M125 52 L123.5 31 L111 45 Z" fill="#B18CF7" />
      <Path d="M66 74 C66 52 82 42 100 42 C118 42 134 52 134 74 C134 92 119 102 100 102 C81 102 66 92 66 74 Z" fill="#7D39EB" />
      <Ellipse cx="94.5" cy="89" rx="6.5" ry="4.6" fill="#9A68F2" />
      <Ellipse cx="105.5" cy="89" rx="6.5" ry="4.6" fill="#9A68F2" />
      <Path d="M76 73 Q85 65.5 95 71.5 Q86 80 76 73 Z" fill="#C6FF33" />
      <Path d="M124 73 Q115 65.5 105 71.5 Q114 80 124 73 Z" fill="#C6FF33" />
      <Ellipse cx="86" cy="73" rx="1.9" ry="4.6" fill="#000000" />
      <Ellipse cx="114" cy="73" rx="1.9" ry="4.6" fill="#000000" />
      <Path d="M75.5 72.6 Q85 65 95.5 71 M124.5 72.6 Q115 65 104.5 71" fill="none" stroke="#2A0E5C" strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M79 64.5 L93 67.6 M121 64.5 L107 67.6" fill="none" stroke="#5A22B8" strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M96.6 84 L103.4 84 L100 87.6 Z" fill="#2A0E5C" />
      <Path d="M100 87.6 L100 90 M96.2 91.6 Q98.2 91.2 100 90 Q101.8 91.2 103.8 91.6" fill="none" stroke="#2A0E5C" strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}
