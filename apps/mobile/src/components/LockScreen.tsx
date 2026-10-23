import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '@/auth/session';
import { useTheme } from '@/lib/theme';
import { PlutoMark } from './brand';
import { T } from './T';
import { Btn } from './ui';

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
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.background, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PlutoMark size={40} />
        <T size={30} weight={800} style={{ letterSpacing: -1.2 }}>
          pluto
        </T>
      </View>
      <T tone="muted">Seu app está bloqueado.</T>
      {unlockError && (
        <T tone="danger" style={{ textAlign: 'center' }}>
          {unlockError}
        </T>
      )}
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 8 }}>
        <Btn label="Desbloquear" onPress={() => void run()} busy={busy} />
        <Btn kind="outline" label="Sair da conta" onPress={() => void signOut()} disabled={busy} />
      </View>
    </View>
  );
}
