import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { PlutoLogo } from './brand';
import { Icon } from './Icon';
import { T } from './T';

// Kit visual no padrao do site (apps/web/app/globals.css): cartoes com borda e cantos de 16,
// blocos da Visao geral com 24, botoes em pilula, campos de 48 de altura.

/** Area rolavel da pagina; o espaco de baixo fica livre para a barra de navegacao. */
export function Screen({ children, refreshing, onRefresh, gap = 16 }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; gap?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: 16, gap, paddingBottom: 120 + insets.bottom }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.brand} colors={[t.brand]} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/** Titulo da pagina (24-30 no site) com subtitulo e acao opcional a direita. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <View style={{ flexShrink: 1, gap: 4 }}>
        <T size={26} weight={700} accessibilityRole="header">
          {title}
        </T>
        {subtitle ? <T tone="muted">{subtitle}</T> : null}
      </View>
      {action}
    </View>
  );
}

export function Card({ children, style, hero }: { children: ReactNode; style?: StyleProp<ViewStyle>; hero?: boolean }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.border, borderRadius: hero ? 24 : 16 }, style]}>{children}</View>;
}

export const CardTitle = ({ children }: { children: ReactNode }) => (
  <T size={17} weight={600}>
    {children}
  </T>
);

export const Muted = ({ children, style }: { children: ReactNode; style?: object }) => (
  <T size={13} tone="muted" style={[{ lineHeight: 18 }, style]}>
    {children}
  </T>
);

export const Big = ({ children, color }: { children: ReactNode; color?: string }) => (
  <T size={28} weight={700} color={color} tabular>
    {children}
  </T>
);

type BtnKind = 'primary' | 'outline' | 'accent' | 'brand' | 'danger';

/** Botao em pilula do site (.btn): primary preto, outline, accent lima, brand roxo, danger. */
export function Btn({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  small,
  grow,
}: {
  label: string;
  onPress: () => void;
  kind?: BtnKind;
  icon?: string;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  grow?: boolean;
}) {
  const t = useTheme();
  const style = {
    primary: { bg: t.primary, fg: t.primaryForeground, bd: t.primary },
    outline: { bg: t.card, fg: t.foreground, bd: t.border },
    accent: { bg: t.accent, fg: '#000000', bd: t.accent },
    brand: { bg: t.brand, fg: '#FFFFFF', bd: t.brand },
    danger: { bg: t.dangerSoft, fg: t.dangerText, bd: t.dangerSoft },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        { height: small ? 36 : 44, paddingHorizontal: small ? 14 : 18, backgroundColor: style.bg, borderColor: style.bd, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        grow && { flex: 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={style.fg} />
      ) : (
        <>
          {icon && <Icon icon={icon} size={small ? 14 : 16} color={style.fg} />}
          <T size={small ? 13 : 14} weight={600} color={style.fg} numberOfLines={1}>
            {label}
          </T>
        </>
      )}
    </Pressable>
  );
}

/** Botao redondo com icone (.icon-btn). */
export function IconBtn({ icon, label, onPress, size = 44, badge }: { icon: string; label: string; onPress: () => void; size?: number; badge?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [s.iconBtn, { width: size, height: size, borderColor: t.border, backgroundColor: t.card, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
    >
      <Icon icon={icon} size={18} />
      {badge && <View style={[s.dot, { backgroundColor: t.brand, borderColor: t.card }]} />}
    </Pressable>
  );
}

export function Badge({ label, bg, fg }: { label: string; bg?: string; fg?: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: bg ?? t.muted, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <T size={11} weight={600} color={fg ?? t.foreground}>
        {label}
      </T>
    </View>
  );
}

/** Grupo de pilulas (fundo muted, item ativo em primary), como o Segmented do site. */
export function Segmented<V extends string>({ items, value, onChange }: { items: { id: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[s.segmented, { backgroundColor: t.muted }]}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.id)}
            style={[s.segItem, { backgroundColor: on ? t.primary : 'transparent' }]}
          >
            <T size={13} weight={600} color={on ? t.primaryForeground : t.mutedForeground}>
              {it.label}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Pilulas de escolha unica que quebram linha (formularios). */
export function Chips<V extends string>({ items, value, onChange }: { items: { id: V; label: string }[]; value: V; onChange: (v: V) => void }) {
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
            <T size={13} weight={600}>
              {it.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Folha que sobe por baixo (bottom sheet do site no celular). */
export function Sheet({ visible, onClose, children, title }: { visible: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }]} onPress={onClose} accessibilityLabel="Fechar" />
        <View style={[s.sheet, { backgroundColor: t.card, borderColor: t.border, paddingBottom: 20 + insets.bottom, maxHeight: '92%' }]}>
          <View style={[s.handle, { backgroundColor: t.border }]} />
          <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {title ? (
              <T size={20} weight={700}>
                {title}
              </T>
            ) : null}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Campo do formulario (.field + .input do site). */
export function Field({ label, hint, big, ...input }: TextInputProps & { label: string; hint?: string; big?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T size={13} tone="muted">
        {label}
      </T>
      <TextInput
        placeholderTextColor={t.mutedForeground}
        {...input}
        style={[s.input, { borderColor: t.border, backgroundColor: t.background, color: t.foreground, height: big ? 56 : 48, fontSize: big ? 24 : 16, fontFamily: big ? 'Geist_700Bold' : 'Geist_400Regular' }]}
      />
      {hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

export interface Tile {
  label: string;
  value: string;
  tone?: 'brand' | 'plain';
}
/** Tres blocos de resumo (Transacoes, Contas). */
export function StatTiles({ tiles }: { tiles: Tile[] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {tiles.map((x) => {
        const brand = x.tone === 'brand';
        return (
          <View key={x.label} style={[s.tile, { backgroundColor: brand ? t.brand : t.card, borderColor: brand ? t.brand : t.border }]}>
            <T size={12} weight={500} color={brand ? '#FFFFFF' : t.foreground}>
              {x.label}
            </T>
            <T size={17} weight={700} color={brand ? '#FFFFFF' : t.foreground} numberOfLines={1} adjustsFontSizeToFit tabular>
              {x.value}
            </T>
          </View>
        );
      })}
    </View>
  );
}

/** Barra de progresso (0 a 1). */
export function Progress({ value, color, height = 10 }: { value: number; color?: string; height?: number }) {
  const t = useTheme();
  const v = Math.min(1, Math.max(0, value));
  return (
    <View style={{ height, borderRadius: 99, overflow: 'hidden', backgroundColor: t.muted }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <View style={{ width: `${v * 100}%`, height: '100%', borderRadius: 99, backgroundColor: color ?? t.brand }} />
    </View>
  );
}

/** Linha "rotulo ......... valor". */
export function Row({ label, value, strong, valueColor }: { label: string; value: string; strong?: boolean; valueColor?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <T size={14} tone={strong ? 'default' : 'muted'} weight={strong ? 700 : 400} style={{ flexShrink: 1 }}>
        {label}
      </T>
      <T size={14} weight={strong ? 700 : 600} color={valueColor} tabular>
        {value}
      </T>
    </View>
  );
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
    <View style={[s.notice, { backgroundColor: t.dangerSoft, flexDirection: 'row', gap: 8 }]} accessibilityRole="alert">
      <Icon icon="circle-alert" size={16} color={t.dangerText} />
      <T size={13} color={t.dangerText} style={{ flex: 1 }}>
        {message}
      </T>
    </View>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[s.notice, { backgroundColor: t.brandSoft }]}>
      <T size={13} style={{ lineHeight: 18 }}>
        {children}
      </T>
    </View>
  );
}

/** Estado vazio do site: a gata, titulo, texto e acao. */
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[s.empty, { borderColor: t.border, backgroundColor: t.card }]}>
      <PlutoLogo size={72} />
      <T size={17} weight={600} style={{ textAlign: 'center' }}>
        {title}
      </T>
      <T size={14} tone="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
        {text}
      </T>
      {action}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, padding: 18, gap: 10, minWidth: 0 },
  btn: { borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  iconBtn: { borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 99, borderWidth: 2 },
  segmented: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999 },
  segItem: { height: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 12 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, marginTop: 'auto' },
  handle: { width: 40, height: 4, borderRadius: 99, alignSelf: 'center', marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  tile: { flex: 1, minWidth: 0, borderRadius: 16, borderWidth: 1, padding: 12, gap: 6 },
  notice: { borderRadius: 12, padding: 12 },
  empty: { alignItems: 'center', gap: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 32, paddingHorizontal: 20 },
});
