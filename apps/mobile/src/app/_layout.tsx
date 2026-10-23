import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/auth/session';
import { LockScreen } from '@/components/LockScreen';
import { PrivacyCover } from '@/components/Privacy';
import { useTheme } from '@/lib/theme';

// Raiz: sessao para o app todo; bloqueio e capa de privacidade por cima de qualquer tela.
function Shell() {
  const t = useTheme();
  const { status } = useSession();
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
      {status === 'locked' && <LockScreen />}
      <PrivacyCover />
    </>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
