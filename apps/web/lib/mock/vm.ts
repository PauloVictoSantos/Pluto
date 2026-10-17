// View models: transformam os dados (mock hoje, API amanha) no formato que as telas exibem.
import { MESES_LONGOS, fmt, fmtDate, fmtDay, pct } from '../format';
import { MOCK } from './data';

export interface StatusStyle {
  label: string;
  bg: string;
  fg: string;
  border: string;
}

export const STATUS: Record<string, StatusStyle> = {
  POSTED: { label: 'Concluída', bg: '#C6FF33', fg: '#000', border: 'transparent' },
  PENDING: { label: 'Pendente', bg: 'transparent', fg: 'var(--muted-foreground)', border: 'var(--border)' },
  PROCESSING: { label: 'Processando', bg: 'var(--brand-soft)', fg: 'var(--brand-text)', border: 'transparent' },
};
export const BILL_STATUS: Record<string, StatusStyle> = {
  PAID: { label: 'Paga', bg: '#C6FF33', fg: '#000', border: 'transparent' },
  OPEN: { label: 'A vencer', bg: 'transparent', fg: 'var(--foreground)', border: 'var(--border)' },
  OVERDUE: { label: 'Atrasada', bg: 'var(--danger-soft)', fg: 'var(--danger-text)', border: 'transparent' },
};
export const COB_STATUS: Record<string, StatusStyle> = {
  RECEBIDO: { label: 'Recebido', bg: '#C6FF33', fg: '#000', border: 'transparent' },
  A_RECEBER: { label: 'Em aberto', bg: 'transparent', fg: 'var(--foreground)', border: 'var(--border)' },
  ATRASADO: { label: 'Vencido', bg: 'var(--danger-soft)', fg: 'var(--danger-text)', border: 'transparent' },
};
export const CAT_ICON: Record<string, string> = {
  Delivery: 'utensils', Transporte: 'car', Mercado: 'shopping-cart', 'Contas da casa': 'zap', Assinaturas: 'tv',
  Combustível: 'fuel', Transferência: 'arrow-left-right', Salário: 'briefcase', Saúde: 'heart-pulse', Lazer: 'ticket', Moradia: 'house',
};
const ITEM_STATUS: Record<string, [string, string]> = {
  UPDATED: ['Conectada', '#22C55E'],
  UPDATING: ['Sincronizando', '#7D39EB'],
  LOGIN_ERROR: ['Reconectar', '#EF4444'],
  OUTDATED: ['Desatualizada', '#A1A1AA'],
};

export interface CardVM {
  id: string;
  bank: string;
  last4: string;
  holder: string;
  level: string;
  brand: string;
  bg: string;
  border: string;
  active: boolean;
  status: string;
  statusBg: string;
  statusFg: string;
  bill: string;
  billNum: number;
  due: string;
  limit: string;
  available: string;
  used: string;
  usedPct: number;
}

export const vm = {
  banks() {
    const items = Object.fromEntries(MOCK.pluggy.items.map((i) => [i.id, i]));
    return MOCK.pluggy.accounts
      .filter((a) => a.type === 'BANK')
      .map((a) => {
        const it = items[a.itemId]!, st = ITEM_STATUS[it.status]!;
        return {
          id: a.id, name: a.name, bank: it.connector.name, initials: it.connector.name.slice(0, 2).toUpperCase(),
          color: '#' + it.connector.primaryColor, balanceNum: a.balance, balance: fmt(a.balance),
          status: st[0], dot: st[1], updated: fmtDate(it.lastUpdatedAt),
        };
      });
  },
  total() {
    return MOCK.pluggy.accounts.filter((a) => a.type === 'BANK').reduce((t, a) => t + a.balance, 0);
  },
  kpis() {
    const m = MOCK.insights.monthly, cur = m[m.length - 1]!, prev = m[m.length - 2]!;
    const ch = (a: number, b: number) => ((a - b) / b) * 100;
    return [
      { label: 'Receitas', v: cur.income, c: ch(cur.income, prev.income), icon: 'arrow-down-left', featured: true, invert: false },
      { label: 'Despesas', v: cur.expenses, c: ch(cur.expenses, prev.expenses), icon: 'arrow-up-right', featured: false, invert: true },
      { label: 'Saldo do mês', v: cur.income - cur.expenses, c: ch(cur.income - cur.expenses, prev.income - prev.expenses), icon: 'wallet', featured: false, invert: false },
      { label: 'Investido', v: MOCK.insights.invested.current, c: ch(MOCK.insights.invested.current, MOCK.insights.invested.previous), icon: 'piggy-bank', featured: false, invert: false },
    ].map((k) => {
      const up = k.c >= 0, good = k.invert ? !up : up;
      return {
        label: k.label, value: fmt(k.v), change: pct(k.c), icon: k.icon, arrow: up ? 'arrow-up-right' : 'arrow-down-right',
        bg: k.featured ? '#7D39EB' : 'var(--card)', fg: k.featured ? '#FFFFFF' : 'var(--foreground)',
        border: k.featured ? '#7D39EB' : 'var(--border)', iconBg: k.featured ? 'rgba(255,255,255,.16)' : 'var(--muted)',
        subFg: k.featured ? 'rgba(255,255,255,.85)' : 'var(--muted-foreground)',
        badgeBg: good ? '#C6FF33' : k.featured ? '#FFFFFF' : 'var(--danger-soft)',
        badgeFg: good ? '#000' : k.featured ? '#B42318' : 'var(--danger-text)',
      };
    });
  },
  months() {
    return MOCK.insights.monthly.map((x) => {
      const mi = +x.month.slice(5) - 1;
      return { label: MESES_LONGOS[mi]!.slice(0, 3), full: MESES_LONGOS[mi] + ' ' + x.month.slice(0, 4), income: x.income, expenses: x.expenses };
    });
  },
  categories() {
    const c = MOCK.insights.categories;
    const topIds = ['moradia', 'mercado', 'lazer', 'delivery', 'transporte'];
    const top = c.filter((x) => topIds.includes(x.id));
    const rest = c.filter((x) => !topIds.includes(x.id));
    const total = c.reduce((t, x) => t + x.spent, 0);
    return [...top, { id: 'outros', name: 'Outros', icon: 'receipt', color: '#A1A1AA', spent: rest.reduce((t, x) => t + x.spent, 0), budget: 0, count: 0 }].map(
      (x) => ({ ...x, pct: (x.spent / total) * 100, total }),
    );
  },
  cards(): CardVM[] {
    return MOCK.pluggy.accounts
      .filter((a) => a.subtype === 'CREDIT_CARD' && a.creditData)
      .map((c, i) => {
        const cd = c.creditData!, active = cd.status === 'ACTIVE', used = cd.creditLimit - cd.availableCreditLimit;
        return {
          id: c.id, bank: c.name, last4: c.number, holder: c.owner, level: cd.level, brand: cd.brand === 'VISA' ? 'VISA' : 'mastercard',
          bg: i === 0 ? 'var(--dark-card)' : '#7D39EB', border: i === 0 ? 'var(--border)' : '#7D39EB', active,
          status: active ? 'Ativo' : 'Bloqueado', statusBg: active ? '#C6FF33' : 'rgba(255,255,255,.2)', statusFg: active ? '#000' : '#fff',
          bill: fmt(c.balance), billNum: c.balance, due: fmtDay(cd.balanceDueDate), limit: fmt(cd.creditLimit),
          available: fmt(cd.availableCreditLimit), used: fmt(used), usedPct: (used / cd.creditLimit) * 100,
        };
      });
  },
  score() {
    const sc = MOCK.serasa.score.pontuacao, th = Math.PI * (1 - sc / 1000);
    return {
      value: sc, band: sc > 700 ? 'Excelente' : sc > 500 ? 'Bom' : sc > 300 ? 'Regular' : 'Baixo',
      cx: (110 + 90 * Math.cos(th)).toFixed(1), cy: (110 - 90 * Math.sin(th)).toFixed(1), tip: MOCK.serasa.mensagem,
    };
  },
  stocksTotal() {
    return MOCK.brapi.results.reduce((t, q) => t + q.regularMarketPrice * MOCK.holdings[q.symbol]!, 0);
  },
  assets() {
    return MOCK.brapi.results.map((q) => {
      const up = q.regularMarketChangePercent >= 0, qty = MOCK.holdings[q.symbol]!;
      return {
        symbol: q.symbol, short: q.symbol.slice(0, 4), name: q.longName, qty: qty + ' ações', price: fmt(q.regularMarketPrice),
        position: fmt(q.regularMarketPrice * qty), change: pct(q.regularMarketChangePercent),
        badgeBg: up ? '#C6FF33' : 'var(--danger-soft)', badgeFg: up ? '#000' : 'var(--danger-text)',
      };
    });
  },
  invest() {
    const total = vm.stocksTotal();
    const day = MOCK.brapi.results.reduce((t, q) => t + q.regularMarketChange * MOCK.holdings[q.symbol]!, 0);
    return { total, totalText: fmt(total), dayChange: pct((day / (total - day)) * 100), dayValue: fmt(day) };
  },
  series(range: string) {
    const n = range === '1A' ? 52 : range === '6M' ? 26 : 30;
    const start = range === '1A' ? 36.2 : range === '6M' ? 41.5 : 44.1, end = 46.6;
    return Array.from({ length: n }, (_, i) => start + (end - start) * (i / (n - 1)) + Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.45) * 0.9);
  },
  path(vals: number[], w: number, h: number) {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pts = vals.map((v, i) => [((i / (vals.length - 1)) * w).toFixed(1), (h - 6 - ((v - lo) / (hi - lo)) * (h - 14)).toFixed(1)]);
    const line = 'M' + pts.map((p) => p.join(',')).join(' L');
    return { line, area: line + ` L${w},${h} L0,${h} Z` };
  },
};
