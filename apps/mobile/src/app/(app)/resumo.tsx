import { MeSchema, type Me } from '@pluto/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from '@/api';
import { useSession } from '@/auth/session';
import { useTheme } from '@/lib/theme';

// Resumo provisorio da etapa 2: mostra que a sessao funciona (/me) e permite sair. Os numeros do
// mes entram na etapa 3.
export default function Resumo() {
  const t = useTheme();
  const { status, signOut } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'signedIn') return;
    let alive = true;
    api
      .request('/me', {}, MeSchema)
      .then((m) => alive && setMe(m))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Não foi possível carregar.'));
    return () => {
      alive = false;
    };
  }, [status]);

  return (
    <View style={[s.screen, { backgroundColor: t.bg }]}>
      {me ? <Text style={[s.title, { color: t.text }]}>Olá, {me.name.split(' ')[0]}!</Text> : !error && <ActivityIndicator color={t.brand} />}
      {!!error && <Text style={{ color: t.danger }}>{error}</Text>}
      <Text style={{ color: t.muted, textAlign: 'center' }}>O resumo do mês chega na próxima versão do app.</Text>
      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={[s.button, { borderColor: t.border }]}>
        <Text style={{ color: t.text, fontWeight: '600' }}>Sair da conta</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  button: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
});
