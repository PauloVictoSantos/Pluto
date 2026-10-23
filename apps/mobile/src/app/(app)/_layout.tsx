import { Redirect, Stack, router, usePathname } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/auth/session';
import { PlutoLogo } from '@/components/brand';
import { BottomBar } from '@/components/shell/BottomBar';
import { ChatPanel } from '@/components/shell/ChatPanel';
import { Header } from '@/components/shell/Header';
import { AccountSheet, AlertsSheet, LogoutSheet, MoreSheet, useAlerts } from '@/components/shell/Sheets';
import { api } from '@/api';
import { ROUTES, pageFromPath, type NavId, type PageId } from '@/lib/nav';
import { usePrefs } from '@/lib/theme';

// Area logada com o casco do site no celular: cabecalho, barra de baixo, "Mais", sino, menu da
// conta e o Plutao (botao flutuante). Sem sessao volta para o login; bloqueada, a tela de bloqueio
// fica por cima (layout raiz).
export default function AppLayout() {
  const { theme: t, hideValues } = usePrefs();
  const { status, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const page = pageFromPath(path);
  const [sheet, setSheet] = useState<'more' | 'alerts' | 'account' | 'logout' | null>(null);
  const [chat, setChat] = useState(false);
  const alerts = useAlerts();
  const unread = (alerts.data ?? []).some((a) => !a.readAt);

  const nav = useCallback(
    (id: NavId) => {
      if (id === 'more') return setSheet((s) => (s === 'more' ? null : 'more'));
      if (id === 'logout') return setSheet('logout');
      setSheet(null);
      const to = ROUTES[id as PageId];
      if (to !== path) router.navigate(to);
    },
    [path],
  );
  const openBell = () => {
    setSheet('alerts');
    // Abrir o painel marca os avisos como lidos (o destaque fica ate a proxima atualizacao).
    if (unread) void api.request<void>('/alerts/read', { method: 'POST' }).catch(() => {});
  };

  if (status === 'signedOut') return <Redirect href="/login" />;
  if (status === 'loading')
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <ActivityIndicator color={t.brand} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <Header onHome={() => nav('overview')} onBell={openBell} onAccount={() => setSheet('account')} unread={unread} />
      {/* Ocultar/mostrar valores remonta as paginas: todo dinheiro e formatado de novo. */}
      <View key={hideValues ? 'hidden' : 'shown'} style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: t.background } }} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir chat com o Plutão"
        onPress={() => setChat(true)}
        style={{
          position: 'absolute',
          right: 16,
          bottom: 84 + insets.bottom,
          height: 56,
          paddingHorizontal: 7,
          borderRadius: 99,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.darkCard,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
        }}
      >
        <PlutoLogo size={40} />
      </Pressable>

      <BottomBar page={page} moreOn={sheet === 'more'} onNav={nav} />

      <MoreSheet visible={sheet === 'more'} page={page} onClose={() => setSheet(null)} onNav={nav} onChat={() => (setSheet(null), setChat(true))} />
      <AlertsSheet visible={sheet === 'alerts'} onClose={() => setSheet(null)} onNav={nav} />
      <AccountSheet visible={sheet === 'account'} onClose={() => setSheet(null)} onNav={nav} />
      <LogoutSheet visible={sheet === 'logout'} onClose={() => setSheet(null)} onConfirm={() => (setSheet(null), void signOut())} />
      <ChatPanel open={chat} onClose={() => setChat(false)} />
    </View>
  );
}
