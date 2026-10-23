import { MeSchema } from '@pluto/shared';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/api';
import { usePrefs } from '@/lib/theme';
import { useQueryLite } from '@/lib/use-api';
import { PlutoMark } from '../brand';
import { Icon } from '../Icon';
import { T } from '../T';
import { IconBtn } from '../ui';

const loadMe = () => api.request('/me', {}, MeSchema);
const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Cabecalho do site no celular: marca, ocultar valores, tema, notificacoes e conta. */
export function Header({ onHome, onBell, onAccount, unread }: { onHome: () => void; onBell: () => void; onAccount: () => void; unread: boolean }) {
  const { theme: t, mode, setMode, hideValues, setHideValues } = usePrefs();
  const insets = useSafeAreaInsets();
  const me = useQueryLite(loadMe, ['me']);
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: t.background, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Visão geral" onPress={onHome} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <PlutoMark size={32} />
          <T size={22} weight={800} style={{ letterSpacing: -0.9 }}>
            pluto
          </T>
        </Pressable>
        <IconBtn icon={hideValues ? 'eye-off' : 'eye'} label={hideValues ? 'Mostrar valores' : 'Ocultar valores'} onPress={() => setHideValues(!hideValues)} />
        <IconBtn icon={t.dark ? 'sun' : 'moon'} label={t.dark ? 'Modo claro' : 'Modo escuro'} onPress={() => setMode(t.dark ? 'light' : mode === 'dark' ? 'light' : 'dark')} />
        <IconBtn icon="bell" label={unread ? 'Notificações, há novas' : 'Notificações'} onPress={onBell} badge={unread} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menu da conta"
          onPress={onAccount}
          style={{ height: 44, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingLeft: 5, paddingRight: 8 }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 99, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <T size={13} weight={700} color="#000">
              {me.data ? initials(me.data.name) : ''}
            </T>
          </View>
          <Icon icon="chevron-down" size={15} color={t.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}
