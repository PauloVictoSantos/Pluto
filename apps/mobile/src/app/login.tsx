import { HealthSchema } from '@pluto/shared';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { ApiError, api } from '@/api';
import { createLoginFlow } from '@/auth/flow';
import { useSession } from '@/auth/session';
import { PlutoMark } from '@/components/brand';
import { T } from '@/components/T';
import { Btn, ErrorBox, Field } from '@/components/ui';
import { maskCpf, onlyDigits } from '@/lib/format';
import { useTheme } from '@/lib/theme';

// Login em dois passos, como no site: CPF + senha, depois o codigo do autenticador.
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

  if (status === 'signedIn' || status === 'locked') return <Redirect href="/" />;

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
  const submit = () => {
    if (step === 'password') {
      if (canPassword)
        void run(async () => {
          await flow.start(cpf, password);
          setPassword('');
          setStep('code');
        });
    } else if (canCode)
      void run(async () => {
        await flow.verify(code);
        signedIn();
      });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <PlutoMark size={36} />
          <T size={26} weight={800} style={{ letterSpacing: -1 }}>
            pluto
          </T>
        </View>
        <T size={28} weight={700} accessibilityRole="header">
          {step === 'password' ? 'Que bom te ver' : 'Código do autenticador'}
        </T>
        {step === 'password' && notice && <T tone="muted">{notice}</T>}
        {step === 'code' && <T tone="muted">Abra seu app autenticador e digite o código de 6 dígitos. Também vale um código de recuperação.</T>}

        {step === 'password' ? (
          <>
            <Field label="CPF" value={cpf} onChangeText={(v) => setCpf(maskCpf(v))} keyboardType="number-pad" autoComplete="off" textContentType="username" maxLength={14} placeholder="000.000.000-00" />
            <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="password" onSubmitEditing={submit} />
          </>
        ) : (
          <Field
            label="Código"
            big
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^\dA-Za-z-]/g, '').slice(0, 12))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            onSubmitEditing={submit}
            placeholder="000000"
          />
        )}

        {!!error && <ErrorBox message={error} />}
        <Btn label={step === 'password' ? 'Continuar' : 'Entrar'} onPress={submit} disabled={step === 'password' ? !canPassword : !canCode} busy={busy} />
        {step === 'code' && (
          <Btn
            kind="outline"
            label="Voltar"
            onPress={() => {
              flow.reset();
              setCode('');
              setError('');
              setStep('password');
            }}
          />
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 24, marginTop: 8 }}>
          {server === 'waking' && (
            <>
              <ActivityIndicator size="small" color={t.mutedForeground} />
              <T size={13} tone="muted">
                Acordando o servidor… pode levar até 1 minuto.
              </T>
            </>
          )}
          {server === 'down' && (
            <T size={13} tone="danger">
              Servidor fora do ar agora. Tente de novo em instantes.
            </T>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
