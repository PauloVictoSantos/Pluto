'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { animate, reducedMotion } from '@/lib/motion';

const PHRASES = ['Miau.', 'Seu saldo está em dia.', 'Guarde um pouco este mês.', 'Delivery de novo?', 'Estou de olho nas contas.'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Mood = '' | 'happy' | 'think' | 'no';

interface Props {
  scene?: 'idle' | 'wave' | 'yarn';
  mood?: Mood;
  /** Cobre os olhos com as patas (campo de senha em foco). */
  cover?: boolean;
  /** Mostra balao de fala ao tocar. */
  talk?: boolean;
  /** Mudar o valor faz a gata pular. */
  jumpKey?: number;
  phrases?: string[];
  className?: string;
  style?: CSSProperties;
}

/** A gata Pluto animada: segue o ponteiro, pisca, acena, brinca com novelo e reage ao toque. */
export function PlutoMascot({ scene = 'idle', mood = '', cover = false, talk = true, jumpKey = 0, phrases, className, style }: Props) {
  const [bubble, setBubble] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const props = useRef({ scene, mood, cover });
  const anim = useRef({ tx: 0, ty: 0, lx: 0, ly: 0, cov: 0, eyeK: 1, t0: 0, nextBlink: 0, blinkT: 0, waveT: 0, jumpT: 0, twitchT: 0 });
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevJump = useRef(jumpKey);

  useEffect(() => {
    props.current = { scene, mood, cover };
  });

  useEffect(() => {
    if (scene === 'wave') anim.current.waveT = performance.now() + 500;
  }, [scene]);

  useEffect(() => {
    if (prevJump.current !== jumpKey) {
      prevJump.current = jumpKey;
      anim.current.jumpT = performance.now();
    }
  }, [jumpKey]);

  useEffect(() => {
    if (bubble && bubbleRef.current && !reducedMotion())
      animate(bubbleRef.current, { opacity: [0, 1], y: [8, 0], scale: [0.85, 1] }, { type: 'spring', stiffness: 420, damping: 22 });
  }, [bubble]);

  useEffect(() => () => clearTimeout(bubbleTimer.current), []);

  useEffect(() => {
    const s = anim.current, cache: Record<string, Element | null> = {};
    // Partes do SVG por data-part; o novelo so existe na cena yarn, entao re-busca quando some.
    const part = (k: string) => {
      let el = cache[k];
      if (!el || !el.isConnected) el = cache[k] = svgRef.current?.querySelector(`[data-part="${k}"]`) ?? null;
      return el;
    };
    const set = (k: string, v: string) => part(k)?.setAttribute('transform', v);
    s.t0 = performance.now();
    s.nextBlink = s.t0 + 1800;

    const onMove = (e: PointerEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height * 0.35;
      s.tx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
      s.ty = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
    };

    const tick = (now: number) => {
      const P = props.current, t = (now - s.t0) / 1000, yarn = P.scene === 'yarn', md = P.mood;
      let lx = s.tx, ly = s.ty, aL = 0, aR = 0;
      if (yarn) {
        const x = 100 + Math.sin(t * 1.7) * 60, y = 177 - Math.abs(Math.sin(t * 3.4)) * 10;
        set('yarn', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(Math.sin(t * 1.7) * 220).toFixed(1)})`);
        part('thread')?.setAttribute('d', `M${x.toFixed(1)} ${(y + 11).toFixed(1)} Q${((x + 196) / 2).toFixed(1)} 198 196 190`);
        lx = Math.sin(t * 1.7) * 0.9;
        ly = 0.9;
        const sL = Math.max(0, -Math.sin(t * 1.7)) ** 2, sR = Math.max(0, Math.sin(t * 1.7)) ** 2, jab = Math.max(0, Math.sin(t * 13)) * 10;
        aL = sL * (16 + jab * 0.7);
        aR = -sR * (16 + jab * 0.7);
        set('cat', `rotate(${(Math.sin(t * 6) * 1.5).toFixed(2)} 100 186)`);
      }
      s.cov = lerp(s.cov, P.cover ? 1 : 0, 0.16);
      if (s.cov > 0.01) {
        aL = lerp(aL, 172, s.cov);
        aR = lerp(aR, -172, s.cov);
      }
      const wv = s.waveT && now > s.waveT && now < s.waveT + 2400 ? Math.sin(((now - s.waveT) / 2400) * Math.PI) : 0;
      if (wv) aR = lerp(aR, -145 + Math.sin(now / 110) * 14, Math.min(1, wv * 1.4));
      set('legL', `rotate(${aL.toFixed(2)} 84 130)`);
      set('legR', `rotate(${aR.toFixed(2)} 116 130)`);
      s.lx = lerp(s.lx, lx, 0.08);
      s.ly = lerp(s.ly, ly, 0.08);
      const shake = md === 'no' ? Math.sin(t * 22) * 6 * Math.max(0, Math.sin(t * 1.6)) : 0;
      const tilt = md === 'think' ? 8 + Math.sin(t * 1.4) * 1.5 : s.lx * 5;
      set('head', `translate(${(s.lx * 3).toFixed(2)} ${(s.ly * 2).toFixed(2)}) rotate(${(tilt + shake).toFixed(2)} 100 100)`);
      const px = (s.lx * 2.6).toFixed(2), py = (s.ly * 1.2).toFixed(2);
      set('pupL', `translate(${px} ${py})`);
      set('pupR', `translate(${px} ${py})`);
      if (now > s.nextBlink) {
        s.blinkT = now;
        s.nextBlink = now + 2600 + Math.random() * 3000;
      }
      const k = now - s.blinkT < 140 ? 0.08 : md === 'happy' ? 0.55 : 1;
      s.eyeK = lerp(s.eyeK, k, 0.5);
      set('eyeL', `translate(86 73) scale(1 ${s.eyeK.toFixed(3)}) translate(-86 -73)`);
      set('eyeR', `translate(114 73) scale(1 ${s.eyeK.toFixed(3)}) translate(-114 -73)`);
      const tw = s.twitchT && now - s.twitchT < 420 ? Math.sin(((now - s.twitchT) / 420) * Math.PI * 4) * 8 : 0;
      const earBack = md === 'no' ? -10 : 0;
      set('earL', `rotate(${(tw + earBack).toFixed(2)} 82 52)`);
      set('earR', `rotate(${(-tw * 0.6 - earBack).toFixed(2)} 118 52)`);
      set('tail', `rotate(${(Math.sin(t * (yarn ? 5 : 1.6)) * (yarn ? 14 : 7)).toFixed(2)} 132 178)`);
      let jy = 0, sq = 1;
      if (s.jumpT) {
        const q = (now - s.jumpT) / 650;
        if (q < 1) {
          jy = Math.sin(q * Math.PI) * 22;
          sq = q < 0.12 ? 1 - q : 1 + Math.sin(q * Math.PI) * 0.04;
        } else s.jumpT = 0;
      }
      const br = 1 + Math.sin(t * 2) * 0.01;
      if (!yarn)
        set('cat', `translate(0 ${(-jy).toFixed(2)}) translate(100 186) scale(${(1 / Math.sqrt(sq)).toFixed(3)} ${(sq * br).toFixed(3)}) translate(-100 -186)`);
      const sh = part('shadow');
      if (sh) {
        sh.setAttribute('rx', (54 - jy * 0.6).toFixed(1));
        sh.setAttribute('opacity', (0.12 - jy * 0.0025).toFixed(3));
      }
    };

    if (reducedMotion()) {
      tick(s.t0);
      return;
    }
    window.addEventListener('pointermove', onMove);
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!document.hidden) tick(now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const onPet = () => {
    anim.current.jumpT = performance.now();
    anim.current.twitchT = performance.now();
    if (!talk) return;
    const list = phrases ?? PHRASES;
    setBubble(list[Math.floor(Math.random() * list.length)]!);
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(''), 2200);
  };

  return (
    <div
      onClick={onPet}
      onPointerEnter={() => (anim.current.twitchT = performance.now())}
      role="img"
      aria-label="Pluto, a gata"
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', cursor: 'pointer', touchAction: 'manipulation', userSelect: 'none', ...style }}
    >
      <svg ref={svgRef} viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <ellipse data-part="shadow" cx="100" cy="188" rx="54" ry="6" fill="#000000" opacity="0.12" />
        <g data-part="cat">
          <g data-part="tail">
            <path d="M132 178 C164 182 176 160 170 138 C167 126 155 124 152 134" fill="none" stroke="#7D39EB" strokeWidth={12} strokeLinecap="round" />
          </g>
          <path d="M62 184 C52 150 66 108 100 100 C134 108 148 150 138 184 Z" fill="#7D39EB" />
          <path d="M88 110 Q100 104 112 110 Q114 140 100 150 Q86 140 88 110 Z" fill="#9A68F2" />
          <path d="M66 172 Q71 152 89 153 M134 172 Q129 152 111 153" fill="none" stroke="#6326C9" strokeWidth={1.5} strokeLinecap="round" />
          <g data-part="head">
            <g data-part="earL">
              <path d="M69 64 L72 24 Q73.5 21 76 23.5 L97 46 Z" fill="#7D39EB" />
              <path d="M75 52 L76.5 31 L89 45 Z" fill="#B18CF7" />
            </g>
            <g data-part="earR">
              <path d="M131 64 L128 24 Q126.5 21 124 23.5 L103 46 Z" fill="#7D39EB" />
              <path d="M125 52 L123.5 31 L111 45 Z" fill="#B18CF7" />
            </g>
            <path d="M66 74 C66 52 82 42 100 42 C118 42 134 52 134 74 C134 92 119 102 100 102 C81 102 66 92 66 74 Z" fill="#7D39EB" />
            <ellipse cx="94.5" cy="89" rx="6.5" ry="4.6" fill="#9A68F2" />
            <ellipse cx="105.5" cy="89" rx="6.5" ry="4.6" fill="#9A68F2" />
            <g data-part="eyeL">
              <path d="M76 73 Q85 65.5 95 71.5 Q86 80 76 73 Z" fill="#C6FF33" />
              <g data-part="pupL">
                <ellipse cx="86" cy="73" rx="1.7" ry="4.4" fill="#000000" />
                <circle cx="88" cy="70.6" r="0.9" fill="#FFFFFF" />
              </g>
              <path d="M75.5 72.6 Q85 65 95.5 71" fill="none" stroke="#2A0E5C" strokeWidth={1.6} strokeLinecap="round" />
            </g>
            <g data-part="eyeR">
              <path d="M124 73 Q115 65.5 105 71.5 Q114 80 124 73 Z" fill="#C6FF33" />
              <g data-part="pupR">
                <ellipse cx="114" cy="73" rx="1.7" ry="4.4" fill="#000000" />
                <circle cx="116" cy="70.6" r="0.9" fill="#FFFFFF" />
              </g>
              <path d="M124.5 72.6 Q115 65 104.5 71" fill="none" stroke="#2A0E5C" strokeWidth={1.6} strokeLinecap="round" />
            </g>
            <path d="M79 64.5 L93 67.6 M121 64.5 L107 67.6" fill="none" stroke="#5A22B8" strokeWidth={2} strokeLinecap="round" />
            <path d="M96.6 84 L103.4 84 L100 87.6 Z" fill="#2A0E5C" />
            <path d="M100 87.6 L100 90 M96.2 91.6 Q98.2 91.2 100 90 Q101.8 91.2 103.8 91.6" fill="none" stroke="#2A0E5C" strokeWidth={1.1} strokeLinecap="round" />
            <path d="M80 86 L54 82.5 M80 89.5 L54 91.5 M120 86 L146 82.5 M120 89.5 L146 91.5" stroke="#5A22B8" strokeWidth={1.1} strokeLinecap="round" />
          </g>
          <g data-part="legL">
            <path d="M77 132 Q77 123 84 123 Q91 123 91 132 C92 148 92 166 91 180 L77 180 C76 168 75 150 77 132 Z" fill="#7D39EB" stroke="#5A22B8" strokeWidth={1.2} />
            <ellipse cx="84" cy="181" rx="10.5" ry="5.5" fill="#8A4BF0" stroke="#5A22B8" strokeWidth={1.2} />
            <path d="M80.5 178.6 L80.5 183 M84 178 L84 183.6 M87.5 178.6 L87.5 183" stroke="#5A22B8" strokeWidth={1.1} strokeLinecap="round" />
          </g>
          <g data-part="legR">
            <path d="M123 132 Q123 123 116 123 Q109 123 109 132 C108 148 108 166 109 180 L123 180 C124 168 125 150 123 132 Z" fill="#7D39EB" stroke="#5A22B8" strokeWidth={1.2} />
            <ellipse cx="116" cy="181" rx="10.5" ry="5.5" fill="#8A4BF0" stroke="#5A22B8" strokeWidth={1.2} />
            <path d="M119.5 178.6 L119.5 183 M116 178 L116 183.6 M112.5 178.6 L112.5 183" stroke="#5A22B8" strokeWidth={1.1} strokeLinecap="round" />
          </g>
        </g>
        {scene === 'yarn' && (
          <>
            <path data-part="thread" d="" fill="none" stroke="#8FBF12" strokeWidth={2} strokeLinecap="round" />
            <g data-part="yarn">
              <circle cx="0" cy="0" r="14" fill="#C6FF33" stroke="#8FBF12" strokeWidth={1.5} />
              <path d="M-12 -5 Q0 -11 12 -5 M-13 3 Q0 -4 13 3 M-9 9 Q0 4 9 9 M-5 -13 Q4 0 -4 13 M5 -13 Q11 0 6 12" fill="none" stroke="#8FBF12" strokeWidth={1.4} strokeLinecap="round" />
            </g>
          </>
        )}
      </svg>
      {bubble && (
        <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', zIndex: 2, pointerEvents: 'none' }}>
          <div
            ref={bubbleRef}
            className="whitespace-nowrap bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground"
            style={{ borderRadius: '14px 14px 14px 4px' }}
          >
            {bubble}
          </div>
        </div>
      )}
    </div>
  );
}
