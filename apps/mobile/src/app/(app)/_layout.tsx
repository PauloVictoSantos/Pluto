import { Redirect, Tabs } from 'expo-router';
import { useSession } from '@/auth/session';
import { useTheme } from '@/lib/theme';

// Area protegida: sem sessao volta para o login. Bloqueada, a tela de bloqueio fica por cima
// (no layout raiz) e nada daqui aparece. As abas Fixos, Metas e Plutao entram na etapa 3.
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
      }}
    >
      <Tabs.Screen name="resumo" options={{ title: 'Resumo' }} />
    </Tabs>
  );
}
