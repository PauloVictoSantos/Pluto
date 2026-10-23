import { brandOf, categoryOf, type MerchantBrand } from '@pluto/shared';
import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BANK_LOGOS, MERCHANT_FILES, SIMPLE_ICONS } from '@/lib/brand-icons.generated';
import { initials } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { T } from './T';

// Bancos e lojas com os mesmos logos do site (apps/web/lib/banks.ts e lib/merchants.tsx).

const BANKS: [RegExp, string, string][] = [
  [/\bitau\b|itau unibanco/, 'itau', '#EC7000'],
  [/bradesco/, 'bradesco', '#CC092F'],
  [/santander/, 'santander', '#EC0000'],
  [/banco do brasil|^bb\b/, 'bb', '#FCFC30'],
  [/nubank|\bnu pagamentos\b|^nu\b/, 'nubank', '#820AD1'],
  [/\bbtg\b/, 'btg', '#001E61'],
  [/\binter\b/, 'inter', '#FF7A00'],
  [/caixa/, 'caixa', '#005CA9'],
  [/mercado ?pago/, 'mercadopago', '#00B1EA'],
  [/\bxp\b/, 'xp', '#000000'],
  [/\bc6\b/, 'c6', '#242424'],
  [/sicredi/, 'sicredi', '#64C832'],
  [/picpay/, 'picpay', '#11C76F'],
  [/\bpan\b/, 'pan', '#FF5200'],
  [/digio/, 'digio', '#202E55'],
  [/\biti\b/, 'iti', '#FF5A70'],
  [/agibank|\bagi\b/, 'agibank', '#3B74E8'],
  [/original/, 'original', '#209425'],
  [/stone/, 'stone', '#00A868'],
];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tidy = (name: string) => {
  const s = name.replace(/\s+(INSTITUI[ÇC][ÃA]O|S\.?A\.?|LTDA).*$/i, '').trim();
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : s;
};

export interface BankBrand {
  key: string | null;
  color: string;
  label: string;
}
export function bankBrand(name: string, fallbackColor?: string | null): BankBrand {
  const hit = BANKS.find(([re]) => re.test(norm(name)));
  return { key: hit?.[1] ?? null, color: hit?.[2] ?? fallbackColor ?? '#7D39EB', label: tidy(name) };
}

/** Logo do banco; sem logo conhecido, as iniciais na cor da instituicao. */
export function BankLogo({ name, color, size = 28, radius }: { name: string; color?: string | null; size?: number; radius?: number }) {
  const b = bankBrand(name, color);
  const src = b.key ? BANK_LOGOS[b.key] : undefined;
  if (src) return <Image source={src} style={{ width: size, height: size, borderRadius: radius ?? size / 2, backgroundColor: '#FFFFFF' }} accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: size, height: size, borderRadius: radius ?? size / 2, backgroundColor: b.color, alignItems: 'center', justifyContent: 'center' }}>
      <T size={Math.round(size * 0.38)} weight={700} color="#FFFFFF">
        {initials(b.label.replace(/^banco\s+/i, ''))}
      </T>
    </View>
  );
}

/** Texto claro ou escuro sobre a cor da marca (contraste). */
export const onColor = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#000000' : '#FFFFFF';
};

const GENERIC: Record<string, string> = { fatura: 'credit-card', iof: 'receipt', restaurante: 'utensils' };

export interface MerchantInfo {
  name: string;
  categoryKey: string | null;
  brand: MerchantBrand | null;
}
/** Nome facil: o que o usuario deu > marca conhecida > grupo > nome do banco > descricao. */
export function merchantInfo(t: { description: string; merchant?: string | null; merchantGroup?: string | null; nameOverride?: string | null }): MerchantInfo {
  const brand = brandOf(t.description) ?? (t.merchant ? brandOf(t.merchant) : null);
  return { name: t.nameOverride ?? brand?.name ?? t.merchantGroup ?? t.merchant ?? t.description, categoryKey: brand?.categoryKey ?? null, brand };
}

/** Logo da marca em circulo; sem marca, o icone da categoria (mesmo visual do site). */
export function MerchantLogo({ brand, categoryKey, size = 42 }: { brand: MerchantBrand | null; categoryKey?: string; size?: number }) {
  const t = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const };
  const file = brand ? MERCHANT_FILES[brand.slug] : undefined;
  if (file) return <Image source={file} style={[box, { backgroundColor: '#FFFFFF' }]} accessibilityLabel={brand!.name} />;
  const si = brand ? SIMPLE_ICONS[brand.slug] : undefined;
  if (si)
    return (
      <View style={[box, { backgroundColor: `#${si.hex}` }]} accessibilityLabel={brand!.name}>
        <Svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5}>
          <Path d={si.path} fill={onColor(`#${si.hex}`)} />
        </Svg>
      </View>
    );
  if (brand && GENERIC[brand.slug])
    return (
      <View style={[box, { backgroundColor: t.muted }]}>
        <Icon icon={GENERIC[brand.slug]!} size={size * 0.42} />
      </View>
    );
  if (brand)
    return (
      <View style={[box, { backgroundColor: brand.color }]} accessibilityLabel={brand.name}>
        <T size={size * 0.42} weight={700} color={onColor(brand.color)}>
          {brand.name.charAt(0).toUpperCase()}
        </T>
      </View>
    );
  return (
    <View style={[box, { backgroundColor: t.muted }]}>
      <Icon icon={categoryOf(categoryKey).icon} size={size * 0.42} />
    </View>
  );
}
