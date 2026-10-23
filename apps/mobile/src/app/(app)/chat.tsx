import { AgentChatStateSchema, type AgentChatState } from '@pluto/shared';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api';
import { Button, Card, ErrorBox, Loading, Muted } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

// Chat com o Plutao (doc. Pluton 7). O agente calcula e propoe; nada e gravado sem o "sim".
// Sem autorizacao de IA (LGPD), mostra o que e enviado e pede o consentimento.
const GREETING = 'Sou o Plutão. Cuido dos seus gastos fixos, metas e do limite do mês. Me diga o que quer comprar ou planejar e eu calculo se cabe.';
const SUGGESTIONS = ['Como está meu mês?', 'Posso comprar um celular de R$ 2.000?', 'Quero criar uma meta', 'Quais dívidas quito primeiro?'];
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const load = () => api.request('/agent/chat', {}, AgentChatStateSchema);

export default function Chat() {
  const t = useTheme();
  // Cabecalho da aba (44) + area segura do topo: o campo sobe junto com o teclado no iOS.
  const headerHeight = useSafeAreaInsets().top + 44;
  const q = useApi(load);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const s = q.data;

  useEffect(() => {
    const id = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [s, sending]);

  const call = async (fn: () => Promise<AgentChatState | void>) => {
    setError('');
    try {
      const next = await fn();
      q.setData(next ?? (await load()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'O Plutão não respondeu agora. Tente de novo.');
    } finally {
      setSending(null);
    }
  };
  const send = (text: string) => {
    const m = text.trim();
    if (!m || sending) return;
    setInput('');
    setSending(m);
    void call(() => api.request('/agent/chat', post({ message: m }), AgentChatStateSchema));
  };

  const bubble = (role: 'user' | 'plutao', text: string, key: string) => (
    <View key={key} style={{ alignItems: role === 'user' ? 'flex-end' : 'flex-start' }}>
      <View style={[st.bubble, role === 'user' ? { backgroundColor: t.brand, borderBottomRightRadius: 4 } : { backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderBottomLeftRadius: 4 }]}>
        <Text style={{ color: role === 'user' ? t.onBrand : t.text, fontSize: 15, lineHeight: 21 }}>{text}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
      <ScrollView ref={list} contentContainerStyle={st.list} keyboardShouldPersistTaps="handled">
        {q.loading && <Loading />}
        {q.error && <ErrorBox message={q.error} />}
        {s && (
          <>
            {bubble('plutao', GREETING, 'greeting')}
            {s.messages.map((m, i) => bubble(m.role, m.text, `${i}-${m.at}`))}
            {sending && bubble('user', sending, 'sending')}
            {sending && (
              <View style={st.thinking}>
                <ActivityIndicator size="small" color={t.brand} />
                <Muted>Plutão está pensando…</Muted>
              </View>
            )}
            {!s.consent && (
              <Card>
                <Text style={{ color: t.text, fontWeight: '700' }}>Antes de começar</Text>
                <Muted>
                  Para conversar, o Plutão envia ao provedor de IA (Google Gemini) só números agregados do seu plano. Extratos completos, nome, CPF, e-mail, telefone e números de conta nunca
                  são enviados. Você pode retirar a autorização no site, em Configurações › Privacidade e dados.
                </Muted>
                <Button label="Autorizo o uso de IA" onPress={() => void call(() => api.request<void>('/agent/consent', post({ accept: true })))} />
              </Card>
            )}
            {s.consent && !s.available && <Muted>O Plutão precisa da IA ligada. Ative a opção de IA nas configurações do site.</Muted>}
            {s.pending && !sending && (
              <Card style={{ borderColor: t.brand, backgroundColor: t.brandSoft }}>
                <Text style={{ color: t.text, fontWeight: '700' }}>Confirma esta ação?</Text>
                <Text style={{ color: t.text, fontSize: 14 }}>{s.pending.summary}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Não" kind="outline" onPress={() => send('não')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Sim, pode gravar" onPress={() => send('sim')} />
                  </View>
                </View>
              </Card>
            )}
            {!!error && <ErrorBox message={error} />}
            {s.consent && !s.messages.length && (
              <View style={st.suggestions}>
                {SUGGESTIONS.map((x) => (
                  <Pressable key={x} accessibilityRole="button" onPress={() => send(x)} style={[st.suggestion, { borderColor: t.border, backgroundColor: t.card }]}>
                    <Text style={{ color: t.text, fontSize: 13 }}>{x}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {!!s.messages.length && !sending && (
              <Pressable accessibilityRole="button" onPress={() => void call(() => api.request('/agent/chat/reset', post(), AgentChatStateSchema))} style={{ alignSelf: 'center', padding: 8 }}>
                <Text style={{ color: t.muted, fontWeight: '600' }}>Nova conversa</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
      <View style={[st.bar, { borderTopColor: t.border, backgroundColor: t.card }]}>
        <TextInput
          style={[st.input, { borderColor: t.border, color: t.text, backgroundColor: t.bg }]}
          value={input}
          onChangeText={setInput}
          placeholder={s?.pending ? 'Responda sim ou não…' : 'Fale com o Plutão…'}
          placeholderTextColor={t.muted}
          maxLength={1000}
          editable={!!s?.consent && !sending}
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
          accessibilityLabel="Mensagem para o Plutão"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar"
          onPress={() => send(input)}
          disabled={!s?.consent || !!sending || !input.trim()}
          style={[st.send, { backgroundColor: t.brand, opacity: !s?.consent || !!sending || !input.trim() ? 0.5 : 1 }]}
        >
          <Text style={{ color: t.onBrand, fontWeight: '700' }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 24 },
  bubble: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: { borderWidth: 1, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 12 },
  bar: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
