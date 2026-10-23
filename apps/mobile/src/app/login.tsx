import { HealthSchema } from '@pluto/shared';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '@/api';
import { createLoginFlow } from '@/auth/flow';
import { useSession } from '@/auth/session';
import { maskCpf, onlyDigits } from '@/lib/format';
import { useTheme } from '@/lib/theme';

// Login em dois passos (o Pluto exige o autenticador): CPF + senha, depois o codigo de 6 digitos.
// Enquanto isso, acorda o servidor do Render (pode levar ~1 min no plano gratuito).
export default function Login() {
  const t = useTheme();
  const { status, notice, signedIn } = useSession();
  const flow = useMemo(() => createLoginFlow(api), []);
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<'waking' | 'up' | 'down'>('waking');

  useEffect(() => {
    let alive = true;
    api
      .request('/health', {}, HealthSchema)
      .then(() => alive && setServer('up'))
      .catch(() => alive && setServer('down'));
    return () => {
      alive = false;
    };
  }, []);

  if (status === 'signedIn' || status === 'locked') return <Redirect href="/resumo" />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };
  const canPassword = onlyDigits(cpf).length === 11 && password.length > 0;
  const canCode = code.trim().length >= 6;
  const submit = () =>
    step === 'password'
      ? canPassword &&
        run(async () => {
          await flow.start(cpf, password);
          setPassword('');
          setStep('code');
        })
      : canCode &&
        run(async () => {
          await flow.verify(code);
          signedIn();
        });

  const input = [s.input, { borderColor: t.border, color: t.text, backgroundColor: t.card }];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
        <Text style={[s.brand, { color: t.brand }]}>Pluto</Text>
        <Text style={[s.title, { color: t.text }]}>{step === 'password' ? 'Que bom te ver' : 'Código do autenticador'}</Text>
        {notice && step === 'password' && <Text style={[s.notice, { color: t.muted }]}>{notice}</Text>}

        {step === 'password' ? (
          <>
            <TextInput
              style={input}
              placeholder="CPF"
              placeholderTextColor={t.muted}
              keyboardType="number-pad"
              autoComplete="off"
              textContentType="username"
              value={cpf}
              onChangeText={(v) => setCpf(maskCpf(v))}
              accessibilityLabel="CPF"
              maxLength={14}
            />
            <TextInput
              style={input}
              placeholder="Senha"
              placeholderTextColor={t.muted}
              secureTextEntry
              textContentType="password"
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              accessibilityLabel="Senha"
            />
          </>
        ) : (
          <>
            <Text style={[s.notice, { color: t.muted }]}>Abra seu app autenticador e digite o código de 6 dígitos. Também vale um código de recuperação.</Text>
            <TextInput
              style={[input, s.code]}
              placeholder="000000"
              placeholderTextColor={t.muted}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^\dA-Za-z-]/g, '').slice(0, 12))}
              onSubmitEditing={submit}
              accessibilityLabel="Código do autenticador"
            />
          </>
        )}

        {!!error && <Text style={[s.error, { color: t.danger }]}>{error}</Text>}

        <Pressable
          accessibilityRole="button"
          style={[s.button, { backgroundColor: t.brand, opacity: (step === 'password' ? canPassword : canCode) && !busy ? 1 : 0.5 }]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color={t.onBrand} /> : <Text style={[s.buttonText, { color: t.onBrand }]}>{step === 'password' ? 'Continuar' : 'Entrar'}</Text>}
        </Pressable>
        {step === 'code' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              flow.reset();
              setCode('');
              setError('');
              setStep('password');
            }}
            style={s.link}
          >
            <Text style={{ color: t.muted, fontWeight: '600' }}>Voltar</Text>
          </Pressable>
        )}

        <View style={s.server}>
          {server === 'waking' && (
            <>
              <ActivityIndicator size="small" color={t.muted} />
              <Text style={{ color: t.muted, fontSize: 13 }}>Acordando o servidor… pode levar até 1 minuto.</Text>
            </>
          )}
          {server === 'down' && <Text style={{ color: t.danger, fontSize: 13 }}>Servidor fora do ar agora. Tente de novo em instantes.</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  brand: { fontSize: 22, fontWeight: '700' },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 6 },
  notice: { fontSize: 14, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  code: { fontSize: 24, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
  error: { fontSize: 14 },
  button: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  link: { alignSelf: 'center', padding: 12 },
  server: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 24, marginTop: 8 },
});
