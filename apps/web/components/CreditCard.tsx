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
        <span className="h-[25px] w-[34px] rounded-md bg-white/25" />
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
