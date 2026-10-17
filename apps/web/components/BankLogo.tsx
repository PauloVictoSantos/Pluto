import { bankBrand } from '@/lib/banks';
import { initials } from '@/lib/format';

/** Logo do banco; sem logo conhecido, mostra as iniciais na cor da instituicao. */
export function BankLogo({ name, color, size = 28 }: { name: string; color?: string | null; size?: number }) {
  const b = bankBrand(name, color);
  if (b.logo) {
    return (
      <img src={b.logo} alt="" width={size} height={size} className="shrink-0 rounded-full bg-white object-contain" style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: b.color, fontSize: Math.round(size * 0.38) }}
    >
      {initials(b.label.replace(/^banco\s+/i, ''))}
    </span>
  );
}
