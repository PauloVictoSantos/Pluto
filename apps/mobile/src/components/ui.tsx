import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

// Pecas visuais comuns das telas (mesma linguagem do site: cartoes brancos, roxo do Pluto).

export function Screen({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={s.screen}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.brand} colors={[t.brand]} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[s.cardTitle, { color: t.text }]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: t.muted, fontSize: 13, lineHeight: 18 }, style]}>{children}</Text>;
}

export function Big({ children, color }: { children: ReactNode; color?: string }) {
  const t = useTheme();
  return <Text style={[s.big, { color: color ?? t.text }]}>{children}</Text>;
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={t.brand} />
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View style={[s.notice, { backgroundColor: t.dangerSoft }]} accessibilityRole="alert">
      <Text style={{ color: t.danger, fontSize: 14 }}>{message}</Text>
    </View>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[s.notice, { backgroundColor: t.brandSoft }]}>
      <Text style={{ color: t.text, fontSize: 13, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'outline' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.brand : kind === 'danger' ? t.dangerSoft : 'transparent';
  const fg = kind === 'primary' ? t.onBrand : kind === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.button, { backgroundColor: bg, borderColor: kind === 'outline' ? t.border : bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{label}</Text>}
    </Pressable>
  );
}

/** Barra de progresso (0 a 1). */
export function Progress({ value, color }: { value: number; color?: string }) {
  const t = useTheme();
  return (
    <View style={[s.track, { backgroundColor: t.border }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(1, Math.max(0, value)) * 100) }}>
      <View style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%`, height: '100%', borderRadius: 99, backgroundColor: color ?? t.brand }} />
    </View>
  );
}

/** Linha "rotulo ......... valor". */
export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={s.row}>
      <Text style={{ color: strong ? t.text : t.muted, fontSize: 14, fontWeight: strong ? '700' : '400', flexShrink: 1 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: strong ? '700' : '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

/** Pilulas de escolha unica. */
export function Chips<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={s.chips} accessibilityRole="radiogroup">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(it.id)}
            style={[s.chip, { backgroundColor: on ? t.brandSoft : t.card, borderColor: on ? t.brand : t.border }]}
          >
            <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  big: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  notice: { borderRadius: 12, padding: 12 },
  button: { borderRadius: 14, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  track: { height: 10, borderRadius: 99, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 12 },
});
