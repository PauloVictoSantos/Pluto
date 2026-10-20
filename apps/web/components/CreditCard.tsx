import type { Card } from '@pluto/shared';
import { siAmericanexpress, siVisa } from 'simple-icons';
import { bankBrand } from '@/lib/banks';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

export interface CardLook {
  name: string;
  last4: string | null;
  institution: string;
  brand: string | null;
  bg: string;
  border: string;
  tag?: string | null;
  /** Nome impresso no cartao (titular). */
  holder?: string | null;
  limitMinor?: number | null;
  usedMinor?: number | null;
}

/**
 * Fundo do cartao pela instituicao e produto (cores das referencias: Bradesco Neo, PicPay e Inter).
 * Sem tema conhecido, alterna as duas cores do design.
 */
export function cardTheme(institution: string, name: string, i = 0): string {
  const n = `${institution} ${name}`.toLowerCase();
  if (/bradesco/.test(n) && /neo/.test(n)) return 'linear-gradient(115deg, #e8173f 0%, #d0156f 34%, #7b27b4 68%, #2a35b5 100%)';
  if (/bradesco/.test(n)) return 'linear-gradient(125deg, #e8173f 0%, #a5102d 100%)';
  if (/picpay/.test(n)) return 'linear-gradient(135deg, #2bd47a 0%, #0b7a45 100%)';
  if (/\binter\b/.test(n)) return '#ff7a00';
  if (/nubank|\bnu\b/.test(n)) return 'linear-gradient(135deg, #9a2bdc 0%, #5b0a99 100%)';
  if (/ita[uú]/.test(n)) return 'linear-gradient(135deg, #ff8a1f 0%, #ec7000 100%)';
  if (/santander/.test(n)) return 'linear-gradient(135deg, #ff2b2b 0%, #b80000 100%)';
  if (/\bc6\b/.test(n)) return '#242424';
  return i % 2 === 0 ? 'var(--dark-card)' : '#7D39EB';
}

/** Aparencia do cartao a partir dos dados do Pluggy. */
export const cardLook = (c: Card, i: number, holder?: string | null): CardLook => ({
  name: c.name,
  last4: c.numberMasked,
  institution: c.institutionName,
  brand: c.brand,
  bg: cardTheme(c.institutionName, c.name, i),
  border: 'transparent',
  holder,
  limitMinor: c.creditLimitMinor,
  usedMinor: c.usedMinor,
});

/** Nome curto do produto: "Bradesco Neo Visa Platinum" -> "Neo Visa Platinum" (o banco ja esta no logo). */
const productName = (name: string, institution: string) => {
  const bank = bankBrand(institution).label.split(' ').pop() ?? '';
  return name.replace(new RegExp(`^\\s*(banco\\s+)?${bank}\\s*`, 'i'), '').trim() || name;
};

/** Bandeira: Visa e American Express pelo simbolo oficial (simple-icons); Mastercard pelos dois circulos oficiais. */
function BrandMark({ brand }: { brand: string | null }) {
  const b = (brand ?? '').toLowerCase();
  if (b.includes('visa'))
    return (
      <svg viewBox="0 0 24 24" width={52} height={26} fill="#fff" role="img" aria-label="Visa" className="shrink-0">
        <path d={siVisa.path} />
      </svg>
    );
  if (b.includes('master'))
    return (
      <svg width="44" height="27" viewBox="0 0 42 26" role="img" aria-label="Mastercard" className="block shrink-0">
        <circle cx="14" cy="13" r="12" fill="#EB001B" />
        <circle cx="28" cy="13" r="12" fill="#F79E1B" />
        <path d="M21 3.25 A12 12 0 0 1 21 22.75 A12 12 0 0 1 21 3.25 Z" fill="#FF5F00" />
      </svg>
    );
  if (b.includes('amex') || b.includes('american'))
    return (
      <svg viewBox="0 0 24 24" width={34} height={34} fill="#fff" role="img" aria-label="American Express" className="shrink-0">
        <path d={siAmericanexpress.path} />
      </svg>
    );
  return brand ? <span className="shrink-0 text-sm font-extrabold tracking-wide uppercase">{brand}</span> : null;
}

function Chip() {
  return (
    <svg width="40" height="30" viewBox="0 0 38 28" aria-hidden className="block shrink-0">
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
  );
}

/**
 * Cartao no layout das referencias (1,586:1, cantos de 18px): logo do banco e produto no topo, chip e
 * aproximacao a esquerda, final, titular embaixo a esquerda e bandeira embaixo a direita. Com limite,
 * mostra a barra de limite usado logo abaixo.
 */
export function CreditCard({ card: c, selected = false }: { card: CardLook; selected?: boolean }) {
  const bank = bankBrand(c.institution);
  const used = c.limitMinor && c.usedMinor != null ? Math.min(1, Math.max(0, c.usedMinor / c.limitMinor)) : null;
  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className="relative box-border flex aspect-[1.586] w-full flex-col justify-between overflow-hidden p-[18px] text-white"
        style={{ borderRadius: 18, background: c.bg, border: `1px solid ${c.border}`, outline: selected ? '2px solid #7D39EB' : 0, outlineOffset: 3 }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {bank.logo && <img src={bank.logo} alt={bank.label} width={28} height={28} className="size-7 shrink-0 rounded-lg bg-white object-contain" />}
            <span className="truncate text-[15px] font-bold tracking-[0.02em] uppercase">{productName(c.name, c.institution)}</span>
          </div>
          {c.tag && <span className="shrink-0 rounded-full bg-white/20 px-[9px] py-[3px] text-[11px] font-semibold">{c.tag}</span>}
        </div>
        <div className="flex items-center gap-2.5">
          <Chip />
          <span className="flex opacity-90">
            <Icon icon="nfc" size={20} />
          </span>
        </div>
        <div className="text-[15px] tracking-[0.14em] whitespace-nowrap tabular-nums">•••• •••• •••• {c.last4 ?? '••••'}</div>
        <div className="flex items-end justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] font-semibold tracking-[0.08em] uppercase opacity-95">{c.holder ?? bank.label}</span>
          <BrandMark brand={c.brand} />
        </div>
      </div>
      {used !== null && (
        <div className="flex flex-col gap-1 px-0.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Limite usado" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full" style={{ width: `${used * 100}%`, background: used >= 0.9 ? '#EF4444' : used >= 0.7 ? '#F59E0B' : 'var(--brand)' }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{money(c.usedMinor!)} usado</span>
            <span>limite {money(c.limitMinor!)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
