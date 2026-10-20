import type { Card } from '@pluto/shared';
import { BankLogo } from './BankLogo';
import { Icon } from './ui/Icon';

export interface CardLook {
  name: string;
  last4: string | null;
  institution: string;
  brand: string | null;
  bg: string;
  border: string;
  tag?: string | null;
}

/** Aparencia do cartao a partir dos dados do Pluggy (alterna as duas cores do design). */
export const cardLook = (c: Card, i: number): CardLook => ({
  name: c.name,
  last4: c.numberMasked,
  institution: c.institutionName,
  brand: c.brand,
  bg: i % 2 === 0 ? 'var(--dark-card)' : '#7D39EB',
  border: i % 2 === 0 ? 'var(--border)' : '#7D39EB',
});

const short = (s: string) => s.replace(/\s+(INSTITUI[ÇC][ÃA]O|S\.?A\.?|LTDA).*$/i, '').trim();

export function CreditCard({ card: c, selected = false }: { card: CardLook; selected?: boolean }) {
  const brand = (c.brand ?? '').toLowerCase();
  return (
    <div
      className="box-border flex aspect-[1.586] w-full flex-col justify-between p-[18px] text-white"
      style={{ borderRadius: 18, background: c.bg, border: `1px solid ${c.border}`, outline: selected ? '2px solid #7D39EB' : 0, outlineOffset: 3 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[15px] font-bold tracking-[-0.01em]">{c.name}</span>
        {c.tag && <span className="shrink-0 rounded-full bg-white/20 px-[9px] py-[3px] text-[11px] font-semibold">{c.tag}</span>}
      </div>
      <div className="flex items-center gap-2.5">
        {/* Chip EMV: placa dourada com os contatos. */}
        <svg width="38" height="28" viewBox="0 0 38 28" aria-hidden className="block shrink-0">
          <defs>
            <linearGradient id="chip-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F4E2A1" />
              <stop offset="0.45" stopColor="#D4AF55" />
              <stop offset="1" stopColor="#A9822F" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width="37" height="27" rx="5" fill="url(#chip-gold)" stroke="#8C6B22" strokeOpacity="0.6" />
          <g fill="none" stroke="#7A5C1B" strokeOpacity="0.75" strokeWidth="1">
            <path d="M0.5 9.5H12M0.5 18.5H12M26 9.5H37.5M26 18.5H37.5" />
            <path d="M12 0.5V27.5M26 0.5V27.5" />
            <rect x="12" y="7" width="14" height="14" rx="3" />
          </g>
        </svg>
        <span className="flex opacity-80">
          <Icon icon="nfc" size={18} />
        </span>
      </div>
      <div className="whitespace-nowrap text-base tracking-[0.14em] tabular-nums">•••• •••• •••• {c.last4 ?? '••••'}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BankLogo name={c.institution} size={26} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.1em] opacity-70">Banco</div>
            <div className="truncate text-[13px] font-semibold tracking-[0.04em] uppercase">{short(c.institution)}</div>
          </div>
        </div>
        {brand.includes('visa') ? (
          <span aria-label="Visa" className="shrink-0 text-[22px] leading-none font-black italic" style={{ fontFamily: "'Arial Black', sans-serif" }}>
            VISA
          </span>
        ) : brand.includes('master') ? (
          <div className="flex shrink-0 flex-col items-center gap-px">
            <svg width="44" height="26" viewBox="0 0 42 24" aria-label="Mastercard" style={{ display: 'block' }}>
              <circle cx="14" cy="12" r="11" fill="#EB001B" />
              <circle cx="28" cy="12" r="11" fill="#F79E1B" />
              <path d="M21 3.515 A11 11 0 0 1 21 20.485 A11 11 0 0 1 21 3.515 Z" fill="#FF5F00" />
            </svg>
            <span className="text-[8px] font-semibold opacity-90">mastercard</span>
          </div>
        ) : (
          c.brand && <span className="shrink-0 text-sm font-extrabold tracking-wide uppercase">{c.brand}</span>
        )}
      </div>
    </div>
  );
}
