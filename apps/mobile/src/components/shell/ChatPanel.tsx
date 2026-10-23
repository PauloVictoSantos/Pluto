import { AgentChatStateSchema, type AgentChatState } from '@pluto/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api';
import { useTheme } from '@/lib/theme';
import { useQueryLite } from '@/lib/use-api';
import { PlutoLogo } from '../brand';
import { Icon } from '../Icon';
import { T } from '../T';
import { Btn, Card, ErrorBox, IconBtn } from '../ui';

// Chat com o Plutao (doc. Pluton 7), como o painel do site: o agente calcula e propoe; nada e
// gravado sem o "sim". Sem autorizacao de IA (LGPD), explica o que e enviado e pede o consentimento.
const GREETING = 'Sou o Plutão. Cuido dos seus gastos fixos, metas e do limite do mês. Me diga o que quer comprar ou planejar e eu calculo se cabe.';
const SUGGESTIONS = ['Como está meu mês?', 'Posso comprar um celular de R$ 2.000?', 'Quero criar uma meta', 'Quais dívidas quito primeiro?', 'Cadastrar um gasto fixo'];
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const loadChat = () => api.request('/agent/chat', {}, AgentChatStateSchema);
/** Escritas pelo chat mudam fixos, metas e o limite nas outras telas. */
const TOUCHED = ['fixed-expenses', 'goals', 'goals-plan', 'goal-drafts', 'agent-limit', 'loans', 'analytics', 'me'];

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const q = useQueryLite(loadChat, ['agent-chat']);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const s = q.data;

  useEffect(() => {
    const id = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [s, sending, open]);

  const call = async (fn: () => Promise<AgentChatState | void>) => {
    setError('');
    try {
      const next = await fn();
      qc.setQueryData(['agent-chat'], next ?? (await loadChat()));
      for (const k of TOUCHED) void qc.invalidateQueries({ queryKey: [k] });
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
      <View
        style={{
          maxWidth: '84%',
          paddingHorizontal: 14,
          paddingVertical: 11,
          backgroundColor: role === 'user' ? t.primary : t.muted,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderBottomLeftRadius: role === 'user' ? 18 : 4,
          borderBottomRightRadius: role === 'user' ? 4 : 18,
        }}
      >
        <T size={15} color={role === 'user' ? t.primaryForeground : t.foreground} style={{ lineHeight: 22 }}>
          {text}
        </T>
      </View>
    </View>
  );

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.card }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <PlutoLogo size={40} />
            </View>
            <View style={{ flex: 1 }}>
              <T size={16} weight={700}>
                Plutão
              </T>
              <T size={12} tone="muted">
                Seu agente financeiro
              </T>
            </View>
            {!!s?.messages.length && <Btn small kind="outline" label="Nova conversa" onPress={() => void call(() => api.request('/agent/chat/reset', post(), AgentChatStateSchema))} />}
            <IconBtn icon="x" label="Fechar" onPress={onClose} />
          </View>
        </View>

        <ScrollView ref={list} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {bubble('plutao', GREETING, 'greeting')}
          {s?.messages.map((m, i) => bubble(m.role, m.text, `${i}-${m.at}`))}
          {sending && bubble('user', sending, 'sending')}
          {sending && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <PlutoLogo size={26} />
              <ActivityIndicator size="small" color={t.brand} />
            </View>
          )}
          {s && !s.consent && (
            <Card>
              <T weight={700}>Antes de começar</T>
              <T size={13} tone="muted" style={{ lineHeight: 18 }}>
                Para conversar, o Plutão envia ao provedor de IA (Google Gemini) só números agregados do seu plano. Extratos completos, nome, CPF, e-mail, telefone e números de conta
                nunca são enviados. Você pode retirar a autorização em Ajustes › Privacidade e dados.
              </T>
              <Btn label="Autorizo o uso de IA" onPress={() => void call(() => api.request<void>('/agent/consent', post({ accept: true })))} />
            </Card>
          )}
          {s?.consent && !s.available && <T tone="muted">O Plutão precisa da IA ligada. Ative a opção de IA em Ajustes.</T>}
          {s?.pending && !sending && (
            <View style={{ gap: 8, borderRadius: 16, borderWidth: 1, borderColor: t.brand, backgroundColor: t.brandSoft, padding: 12 }}>
              <T size={13} weight={600}>
                Confirma esta ação?
              </T>
              <T size={13}>{s.pending.summary}</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn grow kind="outline" label="Não" onPress={() => send('não')} />
                <Btn grow label="Sim, pode gravar" onPress={() => send('sim')} />
              </View>
            </View>
          )}
          {!!error && <ErrorBox message={error} />}
        </ScrollView>

        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: t.border, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom }}>
          {s?.consent && !s.messages.length && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {SUGGESTIONS.map((x) => (
                <Btn key={x} small kind="outline" label={x} onPress={() => send(x)} />
              ))}
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={s?.pending ? 'Responda sim ou não…' : 'Fale com o Plutão…'}
              placeholderTextColor={t.mutedForeground}
              maxLength={1000}
              editable={!!s?.consent && !sending}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
              accessibilityLabel="Mensagem para o Plutão"
              style={{ flex: 1, height: 48, borderRadius: 99, borderWidth: 1, borderColor: t.border, backgroundColor: t.background, color: t.foreground, paddingHorizontal: 16, fontSize: 16, fontFamily: 'Geist_400Regular' }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              onPress={() => send(input)}
              disabled={!s?.consent || !!sending || !input.trim()}
              style={{ width: 48, height: 48, borderRadius: 99, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', opacity: !s?.consent || !!sending || !input.trim() ? 0.5 : 1 }}
            >
              <Icon icon="send-horizontal" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
