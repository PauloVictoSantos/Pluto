import type { CardVM } from '@/lib/mock/vm';
import { Icon } from './ui/Icon';

type CardLook = Pick<CardVM, 'bank' | 'last4' | 'holder' | 'brand' | 'bg' | 'border' | 'status' | 'statusBg' | 'statusFg'>;

export function CreditCard({ card: c, selected = false }: { card: CardLook; selected?: boolean }) {
  const brand = c.brand.toLowerCase();
  return (
    <div
      className="box-border flex aspect-[1.586] w-full flex-col justify-between p-[18px] text-white"
      style={{ borderRadius: 18, background: c.bg, border: `1px solid ${c.border}`, outline: selected ? '2px solid #7D39EB' : 0, outlineOffset: 3 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[15px] font-bold tracking-[-0.01em]">{c.bank}</span>
        <span className="shrink-0 rounded-full px-[9px] py-[3px] text-[11px] font-semibold" style={{ background: c.statusBg, color: c.statusFg }}>
          {c.status}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="h-[25px] w-[34px] rounded-md bg-white/25" />
        <span className="flex opacity-80">
          <Icon icon="nfc" size={18} />
        </span>
      </div>
      <div className="whitespace-nowrap text-base tracking-[0.14em] tabular-nums">•••• •••• •••• {c.last4}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.1em] opacity-70">Titular</div>
          <div className="truncate text-[13px] font-semibold tracking-[0.06em]">{c.holder}</div>
        </div>
        {brand === 'visa' ? (
          <span aria-label="Visa" className="shrink-0 text-[22px] leading-none font-black italic" style={{ fontFamily: "'Arial Black', sans-serif" }}>
            VISA
          </span>
        ) : (
          <div className="flex shrink-0 flex-col items-center gap-px">
            <svg width="44" height="26" viewBox="0 0 42 24" aria-label="Mastercard" style={{ display: 'block' }}>
              <circle cx="14" cy="12" r="11" fill="#EB001B" />
              <circle cx="28" cy="12" r="11" fill="#F79E1B" />
              <path d="M21 3.515 A11 11 0 0 1 21 20.485 A11 11 0 0 1 21 3.515 Z" fill="#FF5F00" />
            </svg>
            <span className="text-[8px] font-semibold opacity-90">mastercard</span>
          </div>
        )}
      </div>
    </div>
  );
}
