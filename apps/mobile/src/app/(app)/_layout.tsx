import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useSession } from '@/auth/session';
import { useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

// Area protegida: sem sessao volta para o login. Bloqueada, a tela de bloqueio fica por cima
// (no layout raiz) e nada daqui aparece.
export default function AppLayout() {
  const t = useTheme();
  const { status } = useSession();
  if (status === 'signedOut') return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="resumo" options={{ title: 'Resumo', tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="fixos" options={{ title: 'Fixos', tabBarIcon: icon('repeat-outline') }} />
      <Tabs.Screen name="metas" options={{ title: 'Metas', tabBarIcon: icon('flag-outline') }} />
      <Tabs.Screen name="chat" options={{ title: 'Plutão', tabBarIcon: icon('chatbubbles-outline') }} />
    </Tabs>
  );
}
