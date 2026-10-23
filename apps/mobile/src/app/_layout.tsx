import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Raiz do app. A sessao, o login e a area protegida entram na etapa 2.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
