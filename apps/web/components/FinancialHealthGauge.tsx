'use client';

import type { FinancialHealth } from '@pluto/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { reducedMotion } from '@/lib/motion';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

// Saude financeira (300-850) no desenho da referencia: arco em 3 segmentos com pontas redondas e
// espacos, textura ondulada, marcador, nota grande, pilula de variacao e botao preto. SVG puro.

const MIN = 300, MAX = 850;
const VB_W = 400, VB_H = 236, CX = 200, CY = 206, R = 150;
const STROKE = Math.round(R * 0.14);
const EASE = 'cubic-bezier(.22,1,.36,1)';
const SEGMENTS = [
  { from: 300, to: 700, label: 'Baixo a regular', range: '300–700', paint: 'url(#hg-warm)' },
  { from: 700, to: 780, label: 'Muito bom', range: '700–780', paint: '#C6F432' },
  { from: 780, to: 850, label: 'Excelente', range: '780–850', paint: '#6FD94A' },
] as const;
const TICKS = [300, 450, 580, 700, 850];
const PERIODS: { id: FinancialHealth['period']; label: string }[] = [
  { id: 'month', label: 'Mês atual' },
  { id: '3m', label: '3 meses' },
  { id: '12m', label: '12 meses' },
];

const tOf = (v: number) => (Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN);
const pt = (t: number, r = R): [number, number] => [CX + r * Math.cos(Math.PI * (1 - t)), CY - r * Math.sin(Math.PI * (1 - t))];
/** Espaco entre segmentos (ja contando as pontas redondas). */
const GAP_T = (STROKE + 7) / R / Math.PI;
function arc(t0: number, t1: number) {
  const [x0, y0] = pt(t0), [x1, y1] = pt(t1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
const segT = (i: number) => {
  const s = SEGMENTS[i]!;
  return [tOf(s.from) + (i > 0 ? GAP_T / 2 : 0), tOf(s.to) - (i < SEGMENTS.length - 1 ? GAP_T / 2 : 0)] as const;
};
/** Mola leve (sem exagero): passa um pouco do alvo e volta. */
const spring = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

export function FinancialHealthGauge({ firstName }: { firstName: string }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<FinancialHealth['period']>('month');
  const q = useQuery({ queryKey: ['analytics', 'health', period], queryFn: () => api.financialHealth(period), staleTime: 5 * 60_000 });
  const h = q.data;
  const [shown, setShown] = useState(MIN);
  const [hover, setHover] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const segRefs = useRef<(SVGPathElement | null)[]>([]);
  const pill = useRef<HTMLSpanElement>(null);
  const halo = useRef<SVGCircleElement>(null);
  const cards = useRef<HTMLDivElement>(null);
  const from = useRef(MIN);
  const raf = useRef(0);

  // Entrada so quando a secao aparece na tela, uma unica vez.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      const t = setTimeout(() => setStarted(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setStarted(true), io.disconnect()), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Desenho dos segmentos em sequencia (com leve sobreposicao) e cascata dos cards.
  const drew = useRef(false);
  useLayoutEffect(() => {
    if (!started || drew.current || reducedMotion()) return;
    drew.current = true;
    segRefs.current.forEach((p, i) =>
      p?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 520, delay: i * 380, easing: EASE, fill: 'backwards' }),
    );
    Array.from(cards.current?.children ?? []).forEach((c, i) =>
      (c as HTMLElement).animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 1200 + i * 60, easing: EASE, fill: 'backwards' }),
    );
  }, [started]);

  // Marcador + numero sincronizados: de onde estao ate a nota (entrada, troca de periodo e recalculo).
  useEffect(() => {
    if (!started || !h) return;
    cancelAnimationFrame(raf.current);
    const target = h.score;
    // Movimento reduzido: o valor final aparece direto (ver "display" abaixo).
    if (reducedMotion()) {
      from.current = target;
      return;
    }
    const start = from.current;
    // Na entrada o marcador sai depois que o arco comeca a se desenhar.
    const delay = start === MIN ? 600 : 0, dur = 900;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const x = Math.min(1, Math.max(0, (now - t0) / dur));
      setShown(Math.round(start + (target - start) * spring(x)));
      if (x < 1) raf.current = requestAnimationFrame(step);
      else {
        from.current = target;
        pill.current?.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: EASE });
      }
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [started, h]);

  // Brilho pulsante discreto no marcador (a cada 3 s).
  useEffect(() => {
    if (!started || reducedMotion() || !halo.current) return;
    const a = halo.current.animate([{ transform: 'scale(1)', opacity: 0.45 }, { transform: 'scale(2.1)', opacity: 0 }], { duration: 1400, iterations: Infinity, easing: 'ease-out', delay: 1600, endDelay: 1600 });
    return () => a.cancel();
  }, [started]);

  const delta = h && h.prevScore !== null ? h.score - h.prevScore : null;
  const display = h && (reducedMotion() || !started) ? h.score : shown;
  const [mx, my] = pt(tOf(started ? display : MIN));
  const hv = hover !== null ? SEGMENTS[hover]! : null;
  const aria = h ? `Saúde financeira: ${h.score} de 850, ${h.band.label.toLowerCase()}${delta ? `, ${delta > 0 ? 'subiu' : 'caiu'} ${Math.abs(delta)} pontos` : ''}` : 'Saúde financeira carregando';

  const cardsData = h
    ? [
        { title: 'Pagamentos em dia', value: h.onTime.pct === null ? '—' : `${Math.round(h.onTime.pct * 100)}%`, impact: 'Alto impacto', tone: 'high', desc: `${h.onTime.paid} de ${h.onTime.due} contas pagas em dia no período`, trend: null, why: 'Faturas e boletos que venceram no período e foram pagos até o vencimento. Pesa 45% da nota.' },
        { title: 'Uso do limite', value: h.limitUse.pct === null ? '—' : `${Math.round(h.limitUse.pct * 100)}%`, impact: 'Alto impacto', tone: 'high', desc: `${money(h.limitUse.usedMinor)} de ${money(h.limitUse.limitMinor)} de limite`, trend: h.limitUse.trend, why: 'Quanto do limite dos cartões está em uso hoje. Até 10% é o ideal; perto de 100% derruba a nota. Pesa 35%. A seta compara a fatura atual com a última fechada.' },
        { title: 'Marcas negativas', value: String(h.negatives.count), impact: 'Alto impacto', tone: 'high', desc: `${h.negatives.overdue} conta(s) atrasada(s) e ${h.negatives.fees} cobrança(s) de juros, rotativo ou IOF`, trend: null, why: 'Contas vencidas sem pagamento e transações na categoria Taxas, juros e IOF no período.' },
        { title: 'Tempo de histórico', value: h.historyMonths >= 12 ? `${Math.floor(h.historyMonths / 12)} ano${h.historyMonths >= 24 ? 's' : ''}` : `${h.historyMonths} ${h.historyMonths === 1 ? 'mês' : 'meses'}`, impact: 'Médio impacto', tone: 'mid', desc: 'Desde a primeira transação importada', trend: null, why: 'Quanto mais histórico, mais confiáveis ficam as análises da Pluto.' },
        { title: 'Parcelamentos abertos', value: String(h.installments.count), impact: 'Baixo impacto', tone: 'low', desc: `${money(h.installments.monthlyMinor)} por mês em parcelas`, trend: null, why: 'Compras parceladas com parcelas por vir, inclusive as dívidas fora do banco. Até 10% da renda mensal é o ideal. Pesa 20%.' },
        { title: 'Compras recentes', value: String(h.purchases), impact: 'Baixo impacto', tone: 'low', desc: 'Compras no cartão no período', trend: null, why: 'Quantidade de compras no cartão no período escolhido.' },
      ]
    : [];
  const TONE: Record<string, { bg: string; fg: string }> = { high: { bg: '#C6F432', fg: '#111' }, mid: { bg: '#DDF59A', fg: '#111' }, low: { bg: '#F97316', fg: '#fff' } };

  return (
    <section ref={root} className="flex flex-col gap-5 overflow-hidden rounded-[28px] p-[clamp(16px,4vw,32px)]" style={{ background: 'var(--health-bg)' }} aria-labelledby="health-title">
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 id="health-title" className="m-0 text-[clamp(20px,4vw,28px)] leading-tight font-semibold tracking-[-0.02em]">
          Olá, {firstName}, esta é a sua saúde financeira 🙂
        </h2>
        <div className="flex gap-1.5 rounded-full p-1" role="tablist" aria-label="Período">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={period === p.id}
              onClick={() => setPeriod(p.id)}
              className="h-10 cursor-pointer rounded-full border px-4 text-[13px] font-semibold"
              style={
                period === p.id
                  ? { background: '#fff', color: '#111', borderColor: 'transparent', boxShadow: '0 4px 14px rgba(0,0,0,.08)' }
                  : { background: 'transparent', color: 'var(--foreground)', borderColor: 'var(--border)' }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[460px]">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="block w-full overflow-visible" role="img" aria-label={aria}>
          <defs>
            <linearGradient id="hg-warm" gradientUnits="userSpaceOnUse" x1={pt(0)[0] - STROKE} y1="0" x2={pt(tOf(700))[0]} y2="0">
              <stop offset="0" stopColor="#F2626B" />
              <stop offset="0.55" stopColor="#F79A3B" />
              <stop offset="1" stopColor="#F6D23E" />
            </linearGradient>
            {/* Textura "impressao digital": linhas senoidais finas, deslizando devagar. */}
            <pattern id="hg-wave" width="12" height="5" patternUnits="userSpaceOnUse">
              <path d="M0 2.5 Q3 0 6 2.5 T12 2.5" fill="none" stroke="#fff" strokeWidth="0.9" strokeOpacity="0.55" />
              {started && !reducedMotion() && <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="12 0" dur="12s" repeatCount="indefinite" />}
            </pattern>
          </defs>
          {SEGMENTS.map((s, i) => {
            const [a, b] = segT(i), d = arc(a, b), w = hover === i ? STROKE + 5 : STROKE;
            return (
              <g key={s.from} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onPointerDown={() => setHover(i)} style={{ cursor: 'pointer' }}>
                <path
                  ref={(el) => {
                    segRefs.current[i] = el;
                  }}
                  d={d}
                  pathLength={1}
                  strokeDasharray="1 1"
                  fill="none"
                  stroke={s.paint}
                  strokeWidth={w}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-width .2s', visibility: started ? 'visible' : 'hidden' }}
                />
                <path d={d} fill="none" stroke="url(#hg-wave)" strokeWidth={w - 2} strokeLinecap="round" opacity={started ? 0.35 : 0} style={{ transition: 'opacity .6s .9s' }} />
              </g>
            );
          })}
          {TICKS.map((v) => {
            const t = tOf(v), [x, y] = pt(t, R + STROKE + 14);
            return (
              <text key={v} x={x} y={t === 0 || t === 1 ? y + 16 : y} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">
                {v}
              </text>
            );
          })}
          {h && started && (
            <g>
              <circle ref={halo} cx={mx} cy={my} r={STROKE * 0.55} fill="#fff" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              <circle cx={mx} cy={my} r={STROKE * 0.55} fill="#fff" stroke="#111" strokeWidth={2.5} />
            </g>
          )}
        </svg>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1" style={{ top: '34%' }}>
          {hv ? (
            <span className="rounded-full bg-dark-card px-3 py-1 text-xs font-semibold text-white">
              {hv.label}, {hv.range}
            </span>
          ) : delta !== null ? (
            <span
              ref={pill}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold"
              style={delta >= 0 ? { background: '#C6F432', color: '#111' } : { background: 'var(--danger-soft)', color: 'var(--danger-text)' }}
            >
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} pts
            </span>
          ) : (
            <span className="h-[26px]" />
          )}
          <span className="text-[clamp(56px,13vw,72px)] leading-none font-medium tracking-[-0.05em] tabular-nums" aria-hidden>
            {h ? display : '—'}
          </span>
          <span className="text-[13px] text-muted-foreground">{h?.band.label ?? 'Calculando…'}</span>
        </div>
      </div>

      <div className="-mt-1 flex justify-center">
        <button
          onClick={() => void qc.invalidateQueries({ queryKey: ['analytics', 'health'] })}
          disabled={q.isFetching}
          aria-label="Recalcular a saúde financeira"
          className="h-12 cursor-pointer rounded-full border-0 bg-black px-8 text-sm font-semibold text-white disabled:opacity-60"
        >
          {q.isFetching ? 'Recalculando…' : 'Recalcular'}
        </button>
      </div>
      {q.isError && <div className="text-center text-sm text-danger-text">Não conseguimos calcular agora. Tente de novo.</div>}

      <div ref={cards} className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 md:grid md:grid-cols-3 md:overflow-visible">
        {cardsData.map((c) => (
          <button
            key={c.title}
            type="button"
            onClick={() => setOpenCard(openCard === c.title ? null : c.title)}
            aria-expanded={openCard === c.title}
            aria-label={`${c.title}: ${c.value}. ${c.impact}. ${c.desc}`}
            className="flex min-w-[230px] cursor-pointer snap-start flex-col gap-3 rounded-[28px] p-5 text-left text-foreground backdrop-blur focus-visible:outline-2 focus-visible:outline-brand md:min-w-0"
            style={{ background: 'var(--health-card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[15px] font-semibold">{c.title}</span>
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border" aria-hidden>
                <Icon icon={openCard === c.title ? 'chevron-up' : 'arrow-up-right'} size={15} />
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[30px] leading-none font-medium tracking-[-0.03em] tabular-nums">
                {c.value}
                {c.trend === 'up' && <span className="ml-1 align-top text-sm text-[#16A34A]">▲</span>}
                {c.trend === 'down' && <span className="ml-1 align-top text-sm text-danger-text">▼</span>}
              </span>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap" style={{ background: TONE[c.tone]!.bg, color: TONE[c.tone]!.fg }}>
                {c.impact}
              </span>
            </div>
            <p className="m-0 text-[13px] leading-snug text-muted-foreground">{c.desc}</p>
            {openCard === c.title && <p className="m-0 border-t border-border pt-2 text-[13px] leading-snug">{c.why}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}
