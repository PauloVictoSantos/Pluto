import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOTTOM, type NavId, type PageId } from '@/lib/nav';
import { useTheme } from '@/lib/theme';
import { Icon } from '../Icon';
import { T } from '../T';

/** Barra de baixo do site no celular: Boleto no centro (botao roxo), item ativo em lima. */
export function BottomBar({ page, moreOn, onNav }: { page: PageId; moreOn: boolean; onNav: (id: NavId) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: 6,
        paddingTop: 6,
        paddingBottom: 8 + insets.bottom,
        backgroundColor: t.background,
        borderTopWidth: 1,
        borderTopColor: t.border,
      }}
    >
      {BOTTOM.map(([id, label, icon]) => {
        const on = id === 'more' ? moreOn : page === id && !moreOn;
        const center = id === 'boleto';
        const color = center ? '#FFFFFF' : on ? '#000000' : t.mutedForeground;
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => onNav(id)} style={{ flex: 1, alignItems: 'center', gap: 4, minHeight: 54 }}>
            <View
              style={
                center
                  ? { width: 52, height: 52, marginTop: -22, borderRadius: 99, backgroundColor: '#7D39EB', alignItems: 'center', justifyContent: 'center', shadowColor: '#7D39EB', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 8 }, elevation: 6 }
                  : { width: 52, height: 30, borderRadius: 99, backgroundColor: on ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }
              }
            >
              <Icon icon={icon} size={center ? 22 : 20} color={color} />
            </View>
            <T size={11} weight={600} color={on ? t.foreground : t.mutedForeground}>
              {label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
