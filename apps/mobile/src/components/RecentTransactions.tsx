import { categoryOf, type Transaction } from '@pluto/shared';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { daysBetween, fmtTimeIn, ymdIn } from '@/lib/dates';
import { fmtDay, money } from '@/lib/format';
import { loadTransactions, useAccounts, useTz } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { useApiQuery } from '@/lib/use-api';
import { PlutoLogo } from './brand';
import { MerchantLogo, merchantInfo } from './brands';
import { Icon } from './Icon';
import { T } from './T';
import { Btn, Card, CardTitle, Loading } from './ui';

// Lista de transacoes no visual do site no celular: grupos por dia, logo da marca, linha de detalhe,
// valor, status e as marcas da camada analitica. A pagina Transacoes completa vem na etapa C.

const STATUS: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  POSTED: { label: 'Concluída', bg: '#C6FF33', fg: '#000000', border: 'transparent' },
  PENDING: { label: 'Pendente', bg: 'transparent', fg: '', border: '' },
};

export function TransactionRow({ t: tx, account, tz, onPress }: { t: Transaction; account: string; tz: string; onPress?: () => void }) {
  const t = useTheme();
  const cat = categoryOf(tx.categoryKey);
  const m = merchantInfo(tx);
  const credit = tx.amountMinor > 0;
  const isBill = tx.categoryKey === 'fatura' || m.brand?.slug === 'fatura';
  const st = STATUS[tx.status] ?? STATUS.PENDING!;
  const marks = [
    ...(tx.recurring ? ['Recorrente'] : []),
    ...(tx.outlier ? ['Fora do normal'] : []),
    ...(tx.tags.includes('dividido') ? [tx.categoryKey === 'pago-dividido' ? 'Dividido entre compras' : 'Parte de pagamento'] : []),
    ...(tx.suggestion ? [`Sugestão: ${categoryOf(tx.suggestion.categoryKey).label}`] : []),
  ];
  const sub = [account, tx.installment ? `Parcela ${tx.installment.n}/${tx.installment.total}` : null, cat.label].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${m.name}, ${cat.label}, ${credit ? 'entrada' : 'saída'} de ${money(Math.abs(tx.amountMinor))}. Ver detalhes`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 8 }}
    >
      <MerchantLogo brand={m.brand} categoryKey={tx.categoryKey} size={42} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={15} weight={600} numberOfLines={1}>
          {m.name}
        </T>
        <T size={12} tone="muted" numberOfLines={1}>
          {sub}
          {tx.hasTime ? ` · ${fmtTimeIn(tx.date, tz)}` : ''}
        </T>
        {marks.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {marks.map((x) => (
              <View key={x} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                <T size={11} weight={500} tone="muted">
                  {x}
                </T>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <T size={15} weight={600} tabular color={isBill ? '#16A34A' : credit ? t.brandText : t.foreground}>
          {(credit ? '+ ' : '− ') + money(Math.abs(tx.amountMinor))}
        </T>
        {tx.installment && (
          <T size={11} tone="muted" tabular>
            de {money(Math.abs(tx.amountMinor * tx.installment.total))}
          </T>
        )}
        <View style={{ borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, backgroundColor: st.bg, borderColor: st.border || t.border }}>
          <T size={11} weight={600} color={st.fg || t.mutedForeground}>
            {st.label}
          </T>
        </View>
      </View>
    </Pressable>
  );
}

/** "Compras recentes" da Visao geral: as ultimas transacoes, agrupadas por dia. */
export function RecentTransactions({ limit = 5, title = 'Compras recentes' }: { limit?: number; title?: string }) {
  const t = useTheme();
  const tz = useTz();
  const accounts = useAccounts();
  const q = useApiQuery(['transactions', { q: '', limit }], () => loadTransactions({ limit }));
  const accName = Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a.numberMasked ? `${a.name} ·${a.numberMasked}` : a.name]));
  const items = q.data?.items ?? [];
  const today = ymdIn(new Date(), tz);
  const groups: { key: string; label: string; rows: Transaction[] }[] = [];
  for (const tx of items) {
    const day = ymdIn(tx.date, tz);
    if (!groups.length || groups[groups.length - 1]!.key !== day) {
      const diff = daysBetween(day, today);
      groups.push({ key: day, label: diff === 0 ? 'Hoje' : diff === 1 ? 'Ontem' : fmtDay(day), rows: [] });
    }
    groups[groups.length - 1]!.rows.push(tx);
  }
  return (
    <Card hero style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <CardTitle>{title}</CardTitle>
          <T size={13} tone="muted">
            {q.isLoading ? 'Carregando…' : q.error ? 'Não foi possível carregar' : `Últimas ${items.length} transações`}
          </T>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.navigate('/transacoes')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, borderRadius: 99, borderWidth: 1, borderColor: t.border, paddingLeft: 14, paddingRight: 10 }}>
          <T size={13} weight={600}>
            Ver todas
          </T>
          <Icon icon="chevron-right" size={16} />
        </Pressable>
      </View>
      {q.isLoading && <Loading />}
      {!q.isLoading && !items.length && (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
          <PlutoLogo size={64} />
          <T size={16} weight={600}>
            {q.error ? 'Não consegui buscar suas transações' : 'Nenhuma transação ainda'}
          </T>
          <T size={14} tone="muted" style={{ textAlign: 'center' }}>
            {q.error ? 'Tente de novo em instantes.' : 'Conecte um banco em Ajustes. A Pluto importa o histórico na hora.'}
          </T>
          {q.error ? <Btn small kind="outline" label="Tentar de novo" onPress={() => void q.refetch()} /> : null}
        </View>
      )}
      {groups.map((g) => (
        <View key={g.key}>
          <T size={12} weight={600} tone="muted" style={{ letterSpacing: 0.7, paddingTop: 6, paddingBottom: 2 }}>
            {g.label.toUpperCase()}
          </T>
          {g.rows.map((tx) => (
            <TransactionRow key={tx.id} t={tx} tz={tz} account={accName[tx.accountId] ?? ''} onPress={() => router.navigate('/transacoes')} />
          ))}
        </View>
      ))}
    </Card>
  );
}
