import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { PlutoMark } from './brand';

/**
 * Esconde os dados financeiros fora do app (guia mobile, secao 7):
 * - iOS: desfoque no seletor de apps;
 * - Android: FLAG_SECURE (preview em branco nos recentes; bloqueia print e gravacao, como apps de banco);
 * - os dois: capa por cima enquanto o app nao esta ativo.
 */
export function PrivacyCover() {
  const t = useTheme();
  const [visible, setVisible] = useState(AppState.currentState !== 'active');

  useEffect(() => {
    if (Platform.OS === 'ios') void ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
    else void ScreenCapture.preventScreenCaptureAsync('pluto').catch(() => {});
    const sub = AppState.addEventListener('change', (s) => setVisible(s !== 'active'));
    return () => sub.remove();
  }, []);

  if (!visible) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
      <PlutoMark size={72} tone="white" />
    </View>
  );
}
