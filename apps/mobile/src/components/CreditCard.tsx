import type { Card } from '@pluto/shared';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { SIMPLE_ICONS } from '@/lib/brand-icons.generated';
import { money } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { BankLogo, bankBrand } from './brands';
import { Icon } from './Icon';
import { T } from './T';

// Cartao no layout das referencias (como apps/web/components/CreditCard.tsx): 1,586:1, cantos de 18.

/** Fundo: cor solida ou degrade (angulo em graus CSS e cores). */
export interface CardBg {
  colors: string[];
  angle?: number;
}

/** Fundo do cartao pela instituicao e produto (mesmas cores do site). */
export function cardTheme(institution: string, name: string, i = 0, darkCard = '#000000'): CardBg {
  const n = `${institution} ${name}`.toLowerCase();
  if (/bradesco/.test(n) && /neo/.test(n)) return { colors: ['#e8173f', '#d0156f', '#7b27b4', '#2a35b5'], angle: 115 };
  if (/bradesco/.test(n)) return { colors: ['#e8173f', '#a5102d'], angle: 125 };
  if (/picpay/.test(n)) return { colors: ['#2bd47a', '#0b7a45'], angle: 135 };
  if (/\binter\b/.test(n)) return { colors: ['#ff7a00'] };
  if (/nubank|\bnu\b/.test(n)) return { colors: ['#9a2bdc', '#5b0a99'], angle: 135 };
  if (/ita[uú]/.test(n)) return { colors: ['#ff8a1f', '#ec7000'], angle: 135 };
  if (/santander/.test(n)) return { colors: ['#ff2b2b', '#b80000'], angle: 135 };
  if (/\bc6\b/.test(n)) return { colors: ['#242424'] };
  return { colors: [i % 2 === 0 ? darkCard : '#7D39EB'] };
}

export interface CardLook {
  name: string;
  last4: string | null;
  institution: string;
  brand: string | null;
  bg: CardBg;
  holder?: string | null;
  limitMinor?: number | null;
  usedMinor?: number | null;
}

export const cardLook = (c: Card, i: number, holder?: string | null, darkCard?: string): CardLook => ({
  name: c.name,
  last4: c.numberMasked,
  institution: c.institutionName,
  brand: c.brand,
  bg: cardTheme(c.institutionName, c.name, i, darkCard),
  holder,
  limitMinor: c.creditLimitMinor,
  usedMinor: c.usedMinor,
});

/** Nome curto do produto: "Bradesco Neo Visa Platinum" -> "Neo Visa Platinum" (o banco ja esta no logo). */
const productName = (name: string, institution: string) => {
  const bank = bankBrand(institution).label.split(' ').pop() ?? '';
  return name.replace(new RegExp(`^\\s*(banco\\s+)?${bank}\\s*`, 'i'), '').trim() || name;
};

/** Pontas de um degrade CSS (angulo em graus) num quadrado unitario. */
function gradientEnds(angle: number) {
  const a = ((angle - 90) * Math.PI) / 180;
  const x = Math.cos(a) / 2, y = Math.sin(a) / 2;
  return { x1: 0.5 - x, y1: 0.5 - y, x2: 0.5 + x, y2: 0.5 + y };
}

let gradSeq = 0;
function Background({ bg }: { bg: CardBg }) {
  if (bg.colors.length === 1) return <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.colors[0] }]} />;
  const id = `cardbg${++gradSeq}`;
  const e = gradientEnds(bg.angle ?? 135);
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
          {bg.colors.map((c, i) => (
            <Stop key={c} offset={i / (bg.colors.length - 1)} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function Chip() {
  return (
    <Svg width={40} height={30} viewBox="0 0 38 28">
      <Defs>
        <LinearGradient id="chipgold" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F4E2A1" />
          <Stop offset="0.45" stopColor="#D4AF55" />
          <Stop offset="1" stopColor="#A9822F" />
        </LinearGradient>
      </Defs>
      <Rect x={0.5} y={0.5} width={37} height={27} rx={5} fill="url(#chipgold)" stroke="#8C6B22" strokeOpacity={0.6} />
      <G fill="none" stroke="#7A5C1B" strokeOpacity={0.75} strokeWidth={1}>
        <Path d="M0.5 9.5H12M0.5 18.5H12M26 9.5H37.5M26 18.5H37.5" />
        <Path d="M12 0.5V27.5M26 0.5V27.5" />
        <Rect x={12} y={7} width={14} height={14} rx={3} />
      </G>
    </Svg>
  );
}

/** Bandeira: Visa e Amex pelo simbolo oficial; Mastercard pelos dois circulos oficiais. */
function BrandMark({ brand }: { brand: string | null }) {
  const b = (brand ?? '').toLowerCase();
  if (b.includes('visa'))
    return (
      <Svg viewBox="0 0 24 24" width={52} height={26} accessibilityLabel="Visa">
        <Path d={SIMPLE_ICONS.visa!.path} fill="#FFFFFF" />
      </Svg>
    );
  if (b.includes('master'))
    return (
      <Svg width={44} height={27} viewBox="0 0 42 26" accessibilityLabel="Mastercard">
        <Circle cx={14} cy={13} r={12} fill="#EB001B" />
        <Circle cx={28} cy={13} r={12} fill="#F79E1B" />
        <Path d="M21 3.25 A12 12 0 0 1 21 22.75 A12 12 0 0 1 21 3.25 Z" fill="#FF5F00" />
      </Svg>
    );
  if (b.includes('amex') || b.includes('american'))
    return (
      <Svg viewBox="0 0 24 24" width={34} height={34} accessibilityLabel="American Express">
        <Path d={SIMPLE_ICONS.americanexpress!.path} fill="#FFFFFF" />
      </Svg>
    );
  return brand ? (
    <T size={14} weight={800} color="#FFFFFF" style={{ letterSpacing: 1 }}>
      {brand.toUpperCase()}
    </T>
  ) : null;
}

export function CreditCard({ card: c, selected = false }: { card: CardLook; selected?: boolean }) {
  const t = useTheme();
  const used = c.limitMinor && c.usedMinor != null ? Math.min(1, Math.max(0, c.usedMinor / c.limitMinor)) : null;
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          aspectRatio: 1.586,
          borderRadius: 18,
          overflow: 'hidden',
          padding: 18,
          justifyContent: 'space-between',
          borderWidth: selected ? 2 : 0,
          borderColor: '#7D39EB',
        }}
        accessibilityLabel={`Cartão ${c.name}, final ${c.last4 ?? 'desconhecido'}`}
      >
        <Background bg={c.bg} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {bankBrand(c.institution).key && <BankLogo name={c.institution} size={28} radius={8} />}
          <T size={15} weight={700} color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1, letterSpacing: 0.3 }}>
            {productName(c.name, c.institution).toUpperCase()}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Chip />
          <Icon icon="nfc" size={20} color="rgba(255,255,255,0.9)" />
        </View>
        <T size={15} color="#FFFFFF" tabular style={{ letterSpacing: 2 }}>
          •••• •••• •••• {c.last4 ?? '••••'}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <T size={12} weight={600} color="rgba(255,255,255,0.95)" numberOfLines={1} style={{ flexShrink: 1, letterSpacing: 1 }}>
            {(c.holder ?? bankBrand(c.institution).label).toUpperCase()}
          </T>
          <BrandMark brand={c.brand} />
        </View>
      </View>
      {used !== null && (
        <View style={{ gap: 4, paddingHorizontal: 2 }}>
          <View style={{ height: 6, borderRadius: 99, overflow: 'hidden', backgroundColor: t.muted }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(used * 100) }}>
            <View style={{ width: `${used * 100}%`, height: '100%', borderRadius: 99, backgroundColor: used >= 0.9 ? '#EF4444' : used >= 0.7 ? '#F59E0B' : t.brand }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T size={11} tone="muted" tabular>
              {money(c.usedMinor!)} usado
            </T>
            <T size={11} tone="muted" tabular>
              limite {money(c.limitMinor!)}
            </T>
          </View>
        </View>
      )}
    </View>
  );
}
