import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/auth/session';
import { useTheme } from '@/lib/theme';

/** Tela de bloqueio: pede a biometria assim que aparece; da para tentar de novo ou sair. */
export function LockScreen() {
  const t = useTheme();
  const { unlock, signOut, unlockError } = useSession();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await unlock();
    } finally {
      setBusy(false);
    }
  };

  // Pede a biometria assim que a tela aparece (unlock e estavel: roda uma vez).
  useEffect(() => {
    void unlock();
  }, [unlock]);

  return (
    <View style={[StyleSheet.absoluteFill, s.screen, { backgroundColor: t.bg }]}>
      <Text style={[s.title, { color: t.brand }]}>Pluto</Text>
      <Text style={[s.text, { color: t.muted }]}>Seu app está bloqueado.</Text>
      {unlockError && <Text style={[s.text, { color: t.danger }]}>{unlockError}</Text>}
      <Pressable accessibilityRole="button" style={[s.button, { backgroundColor: t.brand }]} onPress={run} disabled={busy}>
        {busy ? <ActivityIndicator color={t.onBrand} /> : <Text style={[s.buttonText, { color: t.onBrand }]}>Desbloquear</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void signOut()} disabled={busy} style={s.link}>
        <Text style={{ color: t.muted, fontWeight: '600' }}>Sair da conta</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  title: { fontSize: 34, fontWeight: '700' },
  text: { fontSize: 15, textAlign: 'center' },
  button: { borderRadius: 14, paddingVertical: 15, alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  link: { padding: 12 },
});
