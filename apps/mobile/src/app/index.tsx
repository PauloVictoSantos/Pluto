import { HealthSchema } from '@pluto/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { API_URL, ApiError, api } from '@/api';

// Tela provisoria da etapa 1: confirma que o app fala com a API (acorda o Render se estiver
// dormindo). O login substitui esta tela na etapa 2.
type Status = { kind: 'waiting' } | { kind: 'ok'; db: boolean } | { kind: 'error'; message: string };

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: 'waiting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .request('/health', {}, HealthSchema)
      .then((h) => alive && setStatus({ kind: 'ok', db: h.db === 'up' }))
      .catch((e: unknown) => alive && setStatus({ kind: 'error', message: e instanceof ApiError ? e.message : 'Algo deu errado.' }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  return (
    <View style={s.screen}>
      <Text style={s.title}>Pluto</Text>
      {status.kind === 'waiting' && (
        <View style={s.row}>
          <ActivityIndicator color="#7D39EB" />
          <Text style={s.muted}>Acordando o servidor…</Text>
        </View>
      )}
      {status.kind === 'ok' && <Text style={s.muted}>{status.db ? 'Servidor conectado.' : 'Servidor no ar, mas sem banco de dados agora.'}</Text>}
      {status.kind === 'error' && (
        <>
          <Text style={s.error}>{status.message}</Text>
          <Pressable style={s.button} onPress={() => (setStatus({ kind: 'waiting' }), setAttempt((n) => n + 1))}>
            <Text style={s.buttonText}>Tentar de novo</Text>
          </Pressable>
        </>
      )}
      <Text style={s.small}>{API_URL}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  title: { fontSize: 34, fontWeight: '700', color: '#7D39EB' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { fontSize: 15, color: '#71717A' },
  error: { fontSize: 15, color: '#C62828', textAlign: 'center' },
  button: { backgroundColor: '#7D39EB', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { color: '#fff', fontWeight: '600' },
  small: { fontSize: 12, color: '#A1A1AA', position: 'absolute', bottom: 40 },
});
