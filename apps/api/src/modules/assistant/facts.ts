import { categoryOf } from '@pluto/shared';
import type { ObjectId } from 'mongodb';
import type { Collections } from '../../db/collections';
import { addMonth, monthOf, monthRange, monthStart } from '../../lib/time';

// Fatos calculados pela API para o assistente (secao 5.7). Todo numero que o LLM pode citar
// sai daqui, ja formatado; o modelo nao soma nem projeta nada sozinho.

const brl = (minor: number) => (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (ym: string) => `${MESES[+ym.slice(5) - 1]} de ${ym.slice(0, 4)}`;
const shortBank = (s: string) => s.replace(/\s+(INSTITUI[ÇC][ÃA]O|S\.?A\.?|LTDA).*$/i, '').trim();

export async function buildFacts(col: Collections, userId: ObjectId, now = new Date()): Promise<string> {
  const user = await col.users.findOne({ _id: userId }, { projection: { name: 1, 'settings.timezone': 1 } });
  const tz = user?.settings?.timezone ?? 'America/Manaus';
  const cur = monthOf(now, tz), prev = addMonth(cur, -1);
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const daysInMonth = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5), 0)).getUTCDate();
  const lines: string[] = [];
  const push = (title: string, items: string[]) => items.length && lines.push(`## ${title}`, ...items.map((i) => `- ${i}`), '');

  lines.push(`Hoje: ${todayYmd} (dia ${+todayYmd.slice(8)} de ${daysInMonth} de ${monthName(cur)}). Usuário: ${user?.name?.split(' ')[0] ?? ''}.`, '');

  // Contas
  const conns = new Map((await col.connections.find({ userId, removedAt: null }).toArray()).map((c) => [c._id.toHexString(), c]));
  const accounts = (await col.accounts.find({ userId }).toArray()).filter((a) => conns.has(a.connectionId.toHexString()));
  const cash = accounts.filter((a) => a.type === 'CHECKING' || a.type === 'SAVINGS');
  const byBank = new Map<string, number>();
  cash.forEach((a) => {
    const b = shortBank(conns.get(a.connectionId.toHexString())!.institutionName);
    byBank.set(b, (byBank.get(b) ?? 0) + a.balanceMinor);
  });
  push('Saldo (conta corrente + poupança)', [
    `Total: ${brl(cash.reduce((s, a) => s + a.balanceMinor, 0))}`,
    ...[...byBank].map(([b, v]) => `${b}: ${brl(v)}`),
  ]);

  // Receitas x despesas por mes (TRANSFER e CARD_PAYMENT ficam de fora: RN-13/14)
  const from3 = addMonth(cur, -3);
  const monthly = await col.transactions
    .aggregate<{ _id: string; income: number; expenses: number }>([
      { $match: { userId, deletedAt: null, date: { $gte: monthStart(from3, tz) } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } },
          income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amountMinor', 0] } },
          expenses: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amountMinor', 0] } },
        },
      },
    ])
    .toArray();
  const m = new Map(monthly.map((r) => [r._id, { income: r.income, expenses: -r.expenses }]));
  push(
    'Receitas e gastos por mês (transferências entre contas próprias e pagamento de fatura não contam)',
    [cur, prev, addMonth(cur, -2), from3].map((ym) => {
      const r = m.get(ym) ?? { income: 0, expenses: 0 }, left = r.income - r.expenses;
      return `${monthName(ym)}${ym === cur ? ' (mês atual, parcial)' : ''}: receitas ${brl(r.income)}, gastos ${brl(r.expenses)}, ${left >= 0 ? `sobra ${brl(left)}` : `faltou ${brl(-left)}`}`;
    }),
  );

  // Gastos por categoria: mes atual, anterior e media dos 3 anteriores
  const catRows = await col.transactions
    .aggregate<{ _id: { m: string; k: string }; spent: number; n: number }>([
      { $match: { userId, deletedAt: null, type: 'EXPENSE', date: { $gte: monthStart(from3, tz) } } },
      { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } }, k: '$categoryKey' }, spent: { $sum: '$amountMinor' }, n: { $sum: 1 } } },
    ])
    .toArray();
  const spent = (ym: string, k: string) => -(catRows.find((r) => r._id.m === ym && r._id.k === k)?.spent ?? 0);
  const keys = [...new Set(catRows.map((r) => r._id.k))];
  const curTotal = m.get(cur)?.expenses ?? 0;
  const cats = keys
    .map((k) => ({ k, now: spent(cur, k), prev: spent(prev, k), avg: Math.round((spent(prev, k) + spent(addMonth(cur, -2), k) + spent(from3, k)) / 3), n: catRows.find((r) => r._id.m === cur && r._id.k === k)?.n ?? 0 }))
    .filter((c) => c.now > 0 || c.avg > 0)
    .sort((a, b) => b.now - a.now || b.avg - a.avg);
  push(
    `Gastos por categoria — ${monthName(cur)} (atual) | ${monthName(prev)} | média dos 3 meses anteriores`,
    cats.map((c) => `${categoryOf(c.k).label}: ${brl(c.now)} em ${c.n} lançamento(s) (${pct(c.now, curTotal)} do mês) | ${brl(c.prev)} | média ${brl(c.avg)}`),
  );

  // Para quem/onde mais foi o dinheiro no mes (destinatario ou estabelecimento)
  const { from, to } = monthRange(cur, tz);
  const payees = await col.transactions
    .aggregate<{ _id: string; spent: number; n: number; k: string }>([
      { $match: { userId, deletedAt: null, type: 'EXPENSE', date: { $gte: from, $lt: to } } },
      { $group: { _id: { $ifNull: ['$matchKey', '$descriptionNorm'] }, spent: { $sum: '$amountMinor' }, n: { $sum: 1 }, k: { $first: '$categoryKey' } } },
      { $sort: { spent: 1 } },
      { $limit: 10 },
    ])
    .toArray();
  push(`Maiores destinos de gasto em ${monthName(cur)}`, payees.map((p) => `"${p._id}" (${categoryOf(p.k).label}): ${brl(-p.spent)} em ${p.n} lançamento(s)`));

  // Orcamentos do mes
  const budgets = await col.budgets.find({ userId, month: cur }).toArray();
  push(
    `Orçamento de ${monthName(cur)}`,
    budgets.map((b) => {
      const s = spent(cur, b.categoryKey);
      return `${categoryOf(b.categoryKey).label}: limite ${brl(b.limitMinor)}, gasto ${brl(s)} (${pct(s, b.limitMinor)}), ${s <= b.limitMinor ? `restam ${brl(b.limitMinor - s)}` : `estourou ${brl(s - b.limitMinor)}`}`;
    }),
  );

  // Cartoes e faturas
  const cards = accounts.filter((a) => a.type === 'CREDIT_CARD');
  push(
    'Cartões de crédito',
    cards.map((c) =>
      [
        `${c.name} (${shortBank(conns.get(c.connectionId.toHexString())!.institutionName)})`,
        `fatura atual ${brl(c.balanceMinor)}`,
        c.availableCreditMinor != null ? `limite disponível ${brl(c.availableCreditMinor)}` : null,
        c.creditLimitMinor != null ? `limite total ${brl(c.creditLimitMinor)}` : null,
        c.dueDay ? `vence todo dia ${c.dueDay}` : null,
        c.closingDay ? `fecha dia ${c.closingDay}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    ),
  );
  const overdue = await col.invoices.find({ userId, status: 'OVERDUE', accountId: { $in: cards.map((c) => c._id) } }).toArray();
  push(
    'Faturas que constam como não pagas',
    overdue.map((i) => `${cards.find((c) => c._id.equals(i.accountId))?.name ?? 'Cartão'}: ${brl(i.totalMinor)}, venceu ${i.dueDate.toISOString().slice(0, 10)}`),
  );

  // Metas e investimentos
  const goals = await col.goals.find({ userId }).toArray();
  push(
    'Metas',
    goals.map((g) => `${g.name}: guardado ${brl(g.savedMinor)} de ${brl(g.targetMinor)} (${pct(g.savedMinor, g.targetMinor)}), prazo ${g.deadline}, aporte mensal planejado ${brl(g.monthlyContributionMinor ?? 0)}, faltam ${brl(Math.max(0, g.targetMinor - g.savedMinor))}`),
  );
  const inv = await col.investments.find({ userId }).toArray();
  push('Investimentos', inv.length ? [`Total investido hoje: ${brl(inv.reduce((s, i) => s + i.currentValueMinor, 0))} em ${inv.length} aplicação(ões)`] : ['Nenhum investimento nas contas conectadas']);

  return lines.join('\n');
}
