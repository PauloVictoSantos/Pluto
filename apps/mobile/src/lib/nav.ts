// Navegacao do app: a mesma do site no celular (apps/web/lib/nav.ts, BOTTOM e MORE).
export type PageId =
  | 'overview'
  | 'tx'
  | 'boleto'
  | 'cards'
  | 'list'
  | 'plan'
  | 'budget'
  | 'invest'
  | 'reports'
  | 'bills'
  | 'fixed'
  | 'goals'
  | 'settings'
  | 'help';
export type NavId = PageId | 'more' | 'logout';

export const ROUTES = {
  overview: '/',
  tx: '/transacoes',
  boleto: '/boleto',
  cards: '/cartoes',
  list: '/lista',
  plan: '/planejamento',
  budget: '/orcamento',
  invest: '/investimentos',
  reports: '/relatorios',
  bills: '/contas',
  fixed: '/fixos',
  goals: '/metas',
  settings: '/configuracoes',
  help: '/ajuda',
} as const satisfies Record<PageId, string>;

export function pageFromPath(path: string): PageId {
  const p = path.replace(/\/+$/, '') || '/';
  const hit = (Object.entries(ROUTES) as [PageId, string][]).find(([, r]) => r === p);
  return hit ? hit[0] : 'overview';
}

export const BOTTOM: [NavId, string, string][] = [
  ['overview', 'Início', 'layout-dashboard'],
  ['tx', 'Extrato', 'arrow-left-right'],
  ['boleto', 'Boleto', 'barcode'],
  ['cards', 'Cartões', 'credit-card'],
  ['more', 'Mais', 'layout-grid'],
];

export const MORE: [NavId, string, string][] = [
  ['list', 'Lista de compras', 'list-checks'],
  ['plan', 'Planejamento', 'target'],
  ['budget', 'Orçamento', 'pie-chart'],
  ['invest', 'Investimentos', 'trending-up'],
  ['reports', 'Relatórios', 'bar-chart'],
  ['bills', 'Contas a pagar', 'calendar-days'],
  ['fixed', 'Gastos fixos', 'repeat'],
  ['goals', 'Metas', 'target'],
  ['settings', 'Ajustes', 'settings'],
  ['help', 'Ajuda', 'circle-help'],
  ['logout', 'Sair', 'log-out'],
];
