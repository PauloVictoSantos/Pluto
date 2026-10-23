import { CATEGORIES, FIXED_RECURRENCE_LABEL, FixedExpensesSchema, categoryOf, type FixedExpense, type FixedRecurrence } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { ApiError, api } from '@/api';
import { Icon } from '@/components/Icon';
import { T } from '@/components/T';
import { Btn, Card, CardTitle, Chips, Empty, ErrorBox, Field, Loading, Muted, Notice, PageHeader, Screen, Segmented, Sheet, StatTiles } from '@/components/ui';
import { maskMoney, money, onlyDigits } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useApiQuery } from '@/lib/use-api';

// Gastos fixos (como /fixos no site; mesmo endpoint do Plutao, GF-01). Parcelas de dividas
// aparecem, mas so se editam em Contas a pagar.
const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');
const RECURRENCES = (['monthly', 'weekly', 'yearly'] as const).map((id) => ({ id, label: FIXED_RECURRENCE_LABEL[id] }));
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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
  i.recurrence === 'weekly' ? `toda ${WEEKDAYS[i.dueDay - 1]}` : i.recurrence === 'yearly' ? `todo ano em ${i.dueDay} de ${MONTHS[(i.dueMonth ?? 1) - 1]}` : `todo dia ${i.dueDay}`;

export default function Fixos() {
  const t = useTheme();
  const qc = useQueryClient();
  const q = useApiQuery(['fixed-expenses'], load);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const d = q.data;
  const own = d?.items.filter((i) => i.source !== 'divida') ?? [];
  const debts = d?.items.filter((i) => i.source === 'divida') ?? [];

  const save = useMutation({
    mutationFn: async (action: 'save' | 'delete') => {
      const f = form!;
      const body = {
        name: f.name.trim(),
        categoryKey: f.categoryKey,
        amountMinor: f.amount.minor,
        isVariable: f.isVariable,
        recurrence: f.recurrence,
        dueDay: Number(f.dueDay) || 1,
        dueMonth: f.recurrence === 'yearly' ? Number(f.dueMonth) || 1 : null,
      };
      if (action === 'delete') return api.request(`/agent/fixed-expenses/${f.id}`, { method: 'DELETE' }, FixedExpensesSchema);
      if (f.id) return api.request(`/agent/fixed-expenses/${f.id}`, { method: 'PATCH', body: JSON.stringify(body) }, FixedExpensesSchema);
      return api.request('/agent/fixed-expenses', { method: 'POST', body: JSON.stringify({ ...body, source: 'manual' }) }, FixedExpensesSchema);
    },
    onSuccess: (next) => {
      qc.setQueryData(['fixed-expenses'], next);
      for (const k of ['agent-limit', 'analytics', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] });
      setForm(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  const ok = !!form && !!form.name.trim() && form.amount.minor > 0 && Number(form.dueDay) >= 1 && Number(form.dueDay) <= (form.recurrence === 'weekly' ? 7 : 31);
  const open = (f: Form) => (setError(''), setForm(f));

  const row = (i: FixedExpense) => {
    const cat = categoryOf(i.categoryKey);
    const readOnly = i.source === 'divida';
    return (
      <Pressable key={i.id} accessibilityRole={readOnly ? 'text' : 'button'} disabled={readOnly} onPress={() => open(fromItem(i))} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 99, backgroundColor: t.muted, alignItems: 'center', justifyContent: 'center' }}>
          <Icon icon={cat.icon} size={17} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={15} weight={600} numberOfLines={1}>
            {i.name}
          </T>
          <T size={12.5} tone="muted" numberOfLines={1}>
            {cat.label} · {dueText(i)}
            {i.installment ? ` · parcela ${i.installment.n} de ${i.installment.total}` : ''}
            {i.source === 'chat' ? ' · pelo Plutão' : ''}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T size={15} weight={600} tabular>
            {money(i.amountMinor)}
          </T>
          {i.isVariable ? <T size={11.5} tone="muted">média</T> : i.recurrence !== 'monthly' ? <T size={11.5} tone="muted">{`${money(i.monthlyMinor)}/mês`}</T> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.refresh()}>
        <PageHeader title="Gastos fixos" subtitle="O que sai todo mês antes de qualquer escolha. O Plutão desconta isso antes de calcular o seu limite." />
        <Btn icon="plus" label="Novo gasto fixo" onPress={() => open(blank())} />
        {q.error && <ErrorBox message={q.error} />}
        {q.isLoading && <Loading />}
        {d && (
          <>
            <StatTiles
              tiles={[
                { label: 'Por mês', value: money(d.monthlyTotalMinor), tone: 'brand' },
                { label: 'Da renda', value: d.incomeShare === null ? '—' : `${Math.round(d.incomeShare * 100)}%` },
                { label: 'Gastos', value: String(d.items.length) },
              ]}
            />
            {d.incomeShare !== null && d.incomeShare > 0.5 && <ErrorBox message="Fixos e parcelas passam de 50% da sua renda. O recomendado é ficar abaixo disso para sobrar espaço para metas e imprevistos." />}
            {d.incomeMinor === null && <Notice>Informe sua renda em Ajustes › Perfil financeiro para ver quanto dela os fixos ocupam.</Notice>}
            {!d.items.length && (
              <Empty title="Nenhum gasto fixo ainda" text="Aluguel, luz, internet, academia… Cadastre o que você paga todo mês." action={<Btn icon="plus" label="Cadastrar primeiro" onPress={() => open(blank())} />} />
            )}
            {own.length > 0 && (
              <Card style={{ gap: 0 }}>
                <View style={{ paddingBottom: 8 }}>
                  <CardTitle>Seus gastos fixos</CardTitle>
                </View>
                {own.map(row)}
              </Card>
            )}
            {debts.length > 0 && (
              <Card style={{ gap: 0 }}>
                <CardTitle>Parcelas e dívidas</CardTitle>
                <Muted style={{ paddingBottom: 8 }}>Vêm de Contas a pagar e saem daqui sozinhas quando terminam.</Muted>
                {debts.map(row)}
              </Card>
            )}
          </>
        )}
      </Screen>

      <Sheet visible={!!form} onClose={() => setForm(null)} title={form?.id ? `Editar “${form.name}”` : 'Novo gasto fixo'}>
        {form && (
          <>
            <Field label="Nome" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Ex.: Aluguel" maxLength={60} />
            <Field label={form.isVariable ? 'Valor médio' : 'Valor'} big value={form.amount.text} onChangeText={(v) => setForm({ ...form, amount: maskMoney(v) })} placeholder="R$ 0,00" keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <T size={14} weight={600}>
                  O valor muda todo mês
                </T>
                <T size={12.5} tone="muted">
                  Luz, água, gás: informe uma média.
                </T>
              </View>
              <Switch value={form.isVariable} onValueChange={(v) => setForm({ ...form, isVariable: v })} trackColor={{ true: t.brand }} accessibilityLabel="O valor muda todo mês" />
            </View>
            <View style={{ gap: 6 }}>
              <T size={13} tone="muted">
                Repete
              </T>
              <Segmented items={RECURRENCES} value={form.recurrence} onChange={(r) => setForm({ ...form, recurrence: r, dueDay: r === 'weekly' ? String(Math.min(Number(form.dueDay) || 1, 7)) : form.dueDay })} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label={form.recurrence === 'weekly' ? 'Dia (1 = dom, 7 = sáb)' : 'Dia do vencimento'} value={form.dueDay} onChangeText={(v) => setForm({ ...form, dueDay: onlyDigits(v).slice(0, 2) })} keyboardType="number-pad" />
              </View>
              {form.recurrence === 'yearly' && (
                <View style={{ flex: 1 }}>
                  <Field label="Mês (1 a 12)" value={form.dueMonth} onChangeText={(v) => setForm({ ...form, dueMonth: onlyDigits(v).slice(0, 2) })} keyboardType="number-pad" />
                </View>
              )}
            </View>
            <View style={{ gap: 6 }}>
              <T size={13} tone="muted">
                Categoria
              </T>
              <Chips items={SPEND.map((c) => ({ id: c.key, label: c.label }))} value={form.categoryKey} onChange={(k) => setForm({ ...form, categoryKey: k })} />
            </View>
            {!!error && <ErrorBox message={error} />}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {form.id ? <Btn grow kind="danger" label="Excluir" onPress={() => save.mutate('delete')} busy={save.isPending} /> : <Btn grow kind="outline" label="Cancelar" onPress={() => setForm(null)} />}
              <Btn grow label={form.id ? 'Salvar' : 'Cadastrar'} onPress={() => save.mutate('save')} disabled={!ok} busy={save.isPending} />
            </View>
          </>
        )}
      </Sheet>
    </>
  );
}
