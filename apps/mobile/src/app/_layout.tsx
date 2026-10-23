import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_800ExtraBold, useFonts } from '@expo-google-fonts/geist';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '@/auth/session';
import { LockScreen } from '@/components/LockScreen';
import { PrivacyCover } from '@/components/Privacy';
import { PrefsProvider, usePrefs } from '@/lib/theme';
import { queryClient, useClearOnSignOut } from '@/lib/use-api';

// Segura o splash ate a fonte do site (Geist) carregar.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// Raiz: preferencias, dados e sessao para o app todo; bloqueio e capa de privacidade por cima.
function Shell() {
  const { theme: t } = usePrefs();
  const { status } = useSession();
  useClearOnSignOut();
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }} />
      {status === 'locked' && <LockScreen />}
      <PrivacyCover />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_800ExtraBold });
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;
  return (
    <PrefsProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </QueryClientProvider>
    </PrefsProvider>
  );
}
