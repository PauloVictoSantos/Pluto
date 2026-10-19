export type PageId =
  | 'overview' | 'tx' | 'boleto' | 'plan' | 'budget' | 'invest' | 'reports'
  | 'bills' | 'goals' | 'cards' | 'settings' | 'help' | 'list';
export type NavId = PageId | 'logout' | 'more';

// Rotas estaticas (sem segmentos dinamicos) para funcionar no export do Capacitor (secao 3.6).
export const ROUTES: Record<PageId, string> = {
  overview: '/',
  tx: '/transacoes',
  boleto: '/boleto',
  plan: '/planejamento',
  budget: '/orcamento',
  invest: '/investimentos',
  reports: '/relatorios',
  bills: '/contas',
  goals: '/metas',
  cards: '/cartoes',
  settings: '/configuracoes',
  help: '/ajuda',
  list: '/lista',
};

export function pageFromPath(path: string): PageId {
  const p = path.replace(/\/+$/, '') || '/';
  const hit = (Object.entries(ROUTES) as [PageId, string][]).find(([, r]) => r === p);
  return hit ? hit[0] : 'overview';
}

export const TABS: [PageId, string][] = [
  ['overview', 'Visão geral'], ['tx', 'Transações'], ['boleto', 'Boleto'], ['plan', 'Planejamento'],
  ['budget', 'Orçamento'], ['invest', 'Investimentos'], ['reports', 'Relatórios'],
];
export const SIDE_TOP: [PageId, string, string][] = [
  ['overview', 'Dashboard', 'layout-dashboard'], ['list', 'Lista de compras', 'list-checks'], ['bills', 'Contas a pagar', 'calendar-days'], ['goals', 'Metas', 'target'],
  ['cards', 'Cartões', 'credit-card'], ['invest', 'Investimentos', 'trending-up'], ['settings', 'Configurações', 'settings'],
];
export const SIDE_BOTTOM: [NavId, string, string][] = [['help', 'Ajuda', 'circle-help'], ['logout', 'Sair', 'log-out']];
export const BOTTOM: [NavId, string, string][] = [
  ['overview', 'Início', 'layout-dashboard'], ['tx', 'Extrato', 'arrow-left-right'], ['boleto', 'Boleto', 'barcode'],
  ['cards', 'Cartões', 'credit-card'], ['more', 'Mais', 'layout-grid'],
];
export const MORE: [NavId, string, string][] = [
  ['list', 'Lista de compras', 'list-checks'], ['plan', 'Planeja­mento', 'target'], ['budget', 'Orçamento', 'pie-chart'], ['invest', 'Investi­mentos', 'trending-up'],
  ['reports', 'Relatórios', 'bar-chart'], ['bills', 'Contas a pagar', 'calendar-days'], ['goals', 'Metas', 'target'],
  ['settings', 'Ajustes', 'settings'], ['help', 'Ajuda', 'circle-help'], ['logout', 'Sair', 'log-out'],
];
