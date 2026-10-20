import { brandOf, categoryOf, type MerchantBrand } from '@pluto/shared';
import {
  siAliexpress,
  siBurgerking,
  siCrunchyroll,
  siDeezer,
  siIfood,
  siKfc,
  siMax,
  siMcdonalds,
  siMercadopago,
  siNetflix,
  siParamountplus,
  siPlaystation,
  siShopee,
  siSpotify,
  siStarbucks,
  siSteam,
  siUber,
  siUbereats,
  siYoutube,
  type SimpleIcon,
} from 'simple-icons';
import { Icon } from '@/components/ui/Icon';

// Nomes faceis + logos das marcas. Logo sempre o oficial: simbolos do simple-icons (CC0, versao fixa)
// ou arquivo em /public/logos. Marca sem logo disponivel: circulo na cor oficial com a inicial.

const SIMPLE: Record<string, SimpleIcon> = {
  uber: siUber,
  ubereats: siUbereats,
  ifood: siIfood,
  shopee: siShopee,
  aliexpress: siAliexpress,
  netflix: siNetflix,
  spotify: siSpotify,
  youtube: siYoutube,
  max: siMax,
  paramountplus: siParamountplus,
  crunchyroll: siCrunchyroll,
  deezer: siDeezer,
  steam: siSteam,
  playstation: siPlaystation,
  mcdonalds: siMcdonalds,
  burgerking: siBurgerking,
  kfc: siKfc,
  starbucks: siStarbucks,
  mercadopago: siMercadopago,
};

/**
 * Logos oficiais colocados pelo usuario em apps/web/public/logos/<slug>.svg|png|webp (lidos pelo
 * next.config ao iniciar). Tem prioridade sobre o simple-icons. TODO (sem logo no simple-icons):
 *   amazon, shein, mercadolivre, 99, ingresso, sporty, aliancasmanaus
 */
const LOCAL_FILES = new Map(
  (process.env.NEXT_PUBLIC_LOCAL_LOGOS ?? '')
    .split(',')
    .filter(Boolean)
    .map((f) => [f.replace(/\.[a-z]+$/i, '').toLowerCase(), f] as const),
);

/** Categorias genericas (nao sao marca): icone de categoria do app. */
const GENERIC: Record<string, string> = { fatura: 'credit-card', iof: 'receipt', restaurante: 'utensils' };

export interface MerchantInfo {
  name: string;
  categoryKey: string | null;
  brand: MerchantBrand | null;
}

/** Nome facil: marca conhecida > grupo de estabelecimento > nome do banco > descricao original. */
export function merchantInfo(t: { description: string; merchant?: string | null; merchantGroup?: string | null; nameOverride?: string | null }): MerchantInfo {
  const brand = brandOf(t.description) ?? (t.merchant ? brandOf(t.merchant) : null);
  // O nome que o usuario deu ("Renomear") vence; o logo continua o da marca.
  return { name: t.nameOverride ?? brand?.name ?? t.merchantGroup ?? t.merchant ?? t.description, categoryKey: brand?.categoryKey ?? null, brand };
}

/** Texto claro ou escuro sobre a cor da marca (contraste). */
const onColor = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#000' : '#fff';
};

/** Logo da marca em circulo; sem marca, o icone da categoria (mesmo visual em lista, detalhe e busca). */
export function MerchantLogo({ brand, categoryKey, size = 42 }: { brand: MerchantBrand | null; categoryKey?: string; size?: number }) {
  const box = { width: size, height: size };
  const file = brand ? LOCAL_FILES.get(brand.slug) : undefined;
  if (file)
    return <img src={`/logos/${file}`} alt={brand!.name} width={size} height={size} className="shrink-0 rounded-full bg-white object-contain" style={box} />;
  const si = brand ? SIMPLE[brand.slug] : undefined;
  if (si) {
    const bg = `#${si.hex}`;
    return (
      <span className="grid shrink-0 place-items-center rounded-full" style={{ ...box, background: bg }} role="img" aria-label={brand!.name}>
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill={onColor(bg)} aria-hidden>
          <path d={si.path} />
        </svg>
      </span>
    );
  }
  if (brand && GENERIC[brand.slug])
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-muted" style={box} aria-hidden>
        <Icon icon={GENERIC[brand.slug]!} size={size * 0.42} />
      </span>
    );
  if (brand)
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full font-bold"
        style={{ ...box, background: brand.color, color: onColor(brand.color), fontSize: size * 0.42 }}
        role="img"
        aria-label={brand.name}
      >
        {brand.name.charAt(0).toUpperCase()}
      </span>
    );
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-muted" style={box} aria-hidden>
      <Icon icon={categoryOf(categoryKey).icon} size={size * 0.42} />
    </span>
  );
}
