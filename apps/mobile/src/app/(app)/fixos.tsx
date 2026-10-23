import { CATEGORIES, FIXED_RECURRENCE_LABEL, FixedExpensesSchema, categoryOf, type FixedExpense, type FixedRecurrence } from '@pluto/shared';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '@/api';
import { Button, Card, CardTitle, Chips, ErrorBox, Loading, Muted, Notice, Row, Screen } from '@/components/ui';
import { brl, maskMoney, onlyDigits, pct } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

// Gastos fixos (mesmo endpoint do site e do Plutao, GF-01). Parcelas de dividas aparecem aqui, mas
// so se editam em Contas a pagar no site.
const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');
const RECURRENCES = (['monthly', 'weekly', 'yearly'] as const).map((id) => ({ id, label: FIXED_RECURRENCE_LABEL[id] }));
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const load = () => api.request('/agent/fixed-expenses', {}, FixedExpensesSchema);

interface Form {
  id: string | null;
  name: string;
  amount: { text: string; minor: number };
  categoryKey: string;
  recurrence: FixedRecurrence;
  dueDay: string;
  dueMonth: string;
  isVariable: boolean;
}
const blank = (): Form => ({ id: null, name: '', amount: { text: '', minor: 0 }, categoryKey: 'moradia', recurrence: 'monthly', dueDay: '10', dueMonth: '1', isVariable: false });
const fromItem = (i: FixedExpense): Form => ({
  id: i.id,
  name: i.name,
  amount: maskMoney(String(i.amountMinor)),
  categoryKey: i.categoryKey,
  recurrence: i.recurrence,
  dueDay: String(i.dueDay),
  dueMonth: String(i.dueMonth ?? 1),
  isVariable: i.isVariable,
});
const dueText = (i: FixedExpense) =>
  i.recurrence === 'weekly' ? `toda ${WEEKDAYS[i.dueDay - 1]}` : i.recurrence === 'yearly' ? `todo ano, dia ${i.dueDay}/${i.dueMonth}` : `todo dia ${i.dueDay}`;

export default function Fixos() {
  const t = useTheme();
  const q = useApi(load);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const own = d?.items.filter((i) => i.source !== 'divida') ?? [];
  const debts = d?.items.filter((i) => i.source === 'divida') ?? [];

  const save = async (action: 'save' | 'delete') => {
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        categoryKey: form.categoryKey,
        amountMinor: form.amount.minor,
        isVariable: form.isVariable,
        recurrence: form.recurrence,
        dueDay: Number(form.dueDay) || 1,
        dueMonth: form.recurrence === 'yearly' ? Number(form.dueMonth) || 1 : null,
      };
      const next =
        action === 'delete'
          ? await api.request(`/agent/fixed-expenses/${form.id}`, { method: 'DELETE' }, FixedExpensesSchema)
          : form.id
            ? await api.request(`/agent/fixed-expenses/${form.id}`, { method: 'PATCH', body: JSON.stringify(body) }, FixedExpensesSchema)
            : await api.request('/agent/fixed-expenses', { method: 'POST', body: JSON.stringify({ ...body, source: 'manual' }) }, FixedExpensesSchema);
      q.setData(next);
      setForm(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  };
  const ok = !!form && !!form.name.trim() && form.amount.minor > 0 && Number(form.dueDay) >= 1 && Number(form.dueDay) <= (form.recurrence === 'weekly' ? 7 : 31);

  const item = (i: FixedExpense) => {
    const cat = categoryOf(i.categoryKey);
    const readOnly = i.source === 'divida';
    return (
      <Pressable
        key={i.id}
        accessibilityRole={readOnly ? 'text' : 'button'}
        disabled={readOnly}
        onPress={() => (setError(''), setForm(fromItem(i)))}
        style={[s.item, { borderTopColor: t.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>{i.name}</Text>
          <Muted>
            {cat.label} · {dueText(i)}
            {i.installment ? ` · parcela ${i.installment.n} de ${i.installment.total}` : ''}
            {i.source === 'chat' ? ' · pelo Plutão' : ''}
          </Muted>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: t.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{brl(i.amountMinor)}</Text>
          {i.isVariable && <Muted>média</Muted>}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
        {q.error && <ErrorBox message={q.error} />}
        {q.loading && <Loading />}
        {d && (
          <>
            <Card>
              <Muted>Gastos fixos por mês</Muted>
              <Text style={{ color: t.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{brl(d.monthlyTotalMinor)}</Text>
              {d.incomeShare !== null && <Row label="Da sua renda" value={pct(d.incomeShare)} />}
              {d.incomeShare !== null && d.incomeShare > 0.5 && <Notice>Fixos e parcelas passam de 50% da renda. O ideal é ficar abaixo disso.</Notice>}
            </Card>
            <Button label="Novo gasto fixo" onPress={() => (setError(''), setForm(blank()))} />
            {own.length > 0 && (
              <Card>
                <CardTitle>Seus gastos fixos</CardTitle>
                {own.map(item)}
              </Card>
            )}
            {debts.length > 0 && (
              <Card>
                <CardTitle>Parcelas e dívidas</CardTitle>
                <Muted>Vêm de Contas a pagar; edite no site.</Muted>
                {debts.map(item)}
              </Card>
            )}
            {!d.items.length && <Muted style={{ textAlign: 'center' }}>Nenhum gasto fixo ainda. Aluguel, luz, internet, academia…</Muted>}
          </>
        )}
      </Screen>

      <Modal visible={!!form} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setForm(null)}>
        {form && (
          <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled">
              <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{form.id ? 'Editar gasto fixo' : 'Novo gasto fixo'}</Text>
              <Text style={[s.label, { color: t.text }]}>Nome</Text>
              <TextInput style={[s.input, { borderColor: t.border, color: t.text, backgroundColor: t.card }]} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Ex.: Aluguel" placeholderTextColor={t.muted} maxLength={60} />
              <Text style={[s.label, { color: t.text }]}>{form.isVariable ? 'Valor médio' : 'Valor'}</Text>
              <TextInput
                style={[s.input, s.money, { borderColor: t.border, color: t.text, backgroundColor: t.card }]}
                value={form.amount.text}
                onChangeText={(v) => setForm({ ...form, amount: maskMoney(v) })}
                placeholder="R$ 0,00"
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
              />
              <View style={s.switchRow}>
                <Text style={{ color: t.text, flex: 1 }}>O valor muda todo mês (luz, água)</Text>
                <Switch value={form.isVariable} onValueChange={(v) => setForm({ ...form, isVariable: v })} trackColor={{ true: t.brand }} />
              </View>
              <Text style={[s.label, { color: t.text }]}>Repete</Text>
              <Chips items={RECURRENCES} value={form.recurrence} onChange={(r) => setForm({ ...form, recurrence: r })} />
              <Text style={[s.label, { color: t.text }]}>{form.recurrence === 'weekly' ? 'Dia da semana (1 = domingo, 7 = sábado)' : 'Dia do vencimento'}</Text>
              <TextInput style={[s.input, { borderColor: t.border, color: t.text, backgroundColor: t.card }]} value={form.dueDay} onChangeText={(v) => setForm({ ...form, dueDay: onlyDigits(v).slice(0, 2) })} keyboardType="number-pad" />
              {form.recurrence === 'yearly' && (
                <>
                  <Text style={[s.label, { color: t.text }]}>Mês (1 a 12)</Text>
                  <TextInput style={[s.input, { borderColor: t.border, color: t.text, backgroundColor: t.card }]} value={form.dueMonth} onChangeText={(v) => setForm({ ...form, dueMonth: onlyDigits(v).slice(0, 2) })} keyboardType="number-pad" />
                </>
              )}
              <Text style={[s.label, { color: t.text }]}>Categoria</Text>
              <Chips items={SPEND.map((c) => ({ id: c.key, label: c.label }))} value={form.categoryKey} onChange={(k) => setForm({ ...form, categoryKey: k })} />
              {!!error && <ErrorBox message={error} />}
              <Button label={form.id ? 'Salvar' : 'Cadastrar'} onPress={() => void save('save')} disabled={!ok} busy={busy} />
              {form.id && <Button label="Excluir" kind="danger" onPress={() => void save('delete')} busy={busy} />}
              <Button label="Cancelar" kind="outline" onPress={() => setForm(null)} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  sheet: { padding: 20, gap: 10, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 16 },
  money: { fontSize: 22, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
