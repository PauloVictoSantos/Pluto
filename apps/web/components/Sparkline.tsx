'use client';

import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { fmtDay } from '@/lib/format';
import { reducedMotion } from '@/lib/motion';
import { money } from '@/lib/queries';

interface Props {
  data: readonly number[];
  /** Dias (YYYY-MM-DD) de cada ponto, para o tooltip. */
  days?: readonly string[];
  color: string;
  width?: number;
  height?: number;
  /** Area sob a linha com degrade ate transparente. */
  filled?: boolean;
  /** Tooltip com data e valor ao passar o mouse/tocar. */
  interactive?: boolean;
  /** Valores em centavos (tooltip em R$). */
  label: string;
}

/** Curva monotona (Fritsch-Carlson): suave sem "ondas" que inventam picos entre os pontos. */
function monotonePath(pts: readonly [number, number][]): string {
  const n = pts.length;
  if (n < 2) return '';
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (dx[i] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0]! : i === n - 1 ? m[n - 2]! : m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2));
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${pts[i]![0] + h},${pts[i]![1] + t[i]! * h} ${pts[i + 1]![0] - h},${pts[i + 1]![1] - t[i + 1]! * h} ${pts[i + 1]![0]},${pts[i + 1]![1]}`;
  }
  return d;
}

/**
 * Mini grafico de linha em SVG puro (sem eixos nem rotulos). A linha se desenha uma vez ao carregar
 * (sem animacao com prefers-reduced-motion). Com valores ocultos, o formato continua e o tooltip mostra
 * so a data e "R$ ••••" (money ja respeita o modo).
 */
export function Sparkline({ data, days, color, width = 240, height = 48, filled = false, interactive = true, label }: Props) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pad = 4;
  const { pts, path, area } = useMemo(() => {
    if (data.length < 2) return { pts: [] as [number, number][], path: '', area: '' };
    const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
    const p = data.map((v, i) => [pad + (i / (data.length - 1)) * (width - 2 * pad), pad + (1 - (v - min) / span) * (height - 2 * pad)] as [number, number]);
    const line = monotonePath(p);
    return { pts: p, path: line, area: `${line} L${p[p.length - 1]![0]},${height} L${p[0]![0]},${height} Z` };
  }, [data, width, height]);

  // Desenho da linha uma unica vez (stroke-dashoffset).
  const drawn = useRef(false);
  const draw = (el: SVGPathElement | null) => {
    if (!el || drawn.current || reducedMotion()) return;
    drawn.current = true;
    const len = el.getTotalLength();
    el.animate([{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: '0' }], { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)' });
  };

  if (pts.length < 2)
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}: sem dados suficientes`}>
        <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
      </svg>
    );

  const first = data[0]!, last = data[data.length - 1]!;
  const change = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
  const aria = `${label} dos últimos ${data.length} dias${change === null ? '' : `, ${change >= 0 ? 'em alta' : 'em queda'} de ${Math.abs(change).toFixed(1).replace('.', ',')}%`}`;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((x - pad) / (width - 2 * pad)) * (pts.length - 1)))));
  };
  const hp = hover !== null ? pts[hover]! : null;

  return (
    <div className="relative w-full">
      <svg
        ref={svg}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={aria}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ overflow: 'visible', touchAction: 'pan-y' }}
      >
        {filled && (
          <>
            <defs>
              <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity={0.35} />
                <stop offset="1" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#spark-${id})`} />
          </>
        )}
        <path ref={draw} d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hp ? (
          <>
            <line x1={hp[0]} x2={hp[0]} y1={0} y2={height} stroke={color} strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={hp[0]} cy={hp[1]} r={3.5} fill={color} />
          </>
        ) : (
          <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.5} fill={color} />
        )}
      </svg>
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 rounded-lg bg-dark-card px-2 py-1 text-[11px] whitespace-nowrap text-white shadow"
          style={{ left: `${(hp[0] / width) * 100}%` }}
          role="status"
        >
          {days?.[hover] ? `${fmtDay(days[hover]!)} · ` : ''}
          {money(data[hover]!)}
        </div>
      )}
    </div>
  );
}
