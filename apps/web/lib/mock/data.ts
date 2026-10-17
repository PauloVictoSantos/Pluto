// Dados mock do design (mesma forma das respostas externas). Serao substituidos por
// chamadas a API do Pluto (/v1/...) quando os modulos do backend existirem.

export const TODAY = '2026-10-16';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  spent: number;
  budget: number;
  count: number;
}
export interface Goal {
  id: string;
  name: string;
  icon: string;
  target: number;
  saved: number;
  deadline: string;
}
export type BillStatus = 'PAID' | 'OPEN' | 'OVERDUE';
export interface Bill {
  id: string;
  description: string;
  category: string;
  icon: string;
  amount: number;
  dueDate: string;
  status: BillStatus;
}
export interface Plan {
  month: string;
  income: number;
  strategy: string;
  budgets: Record<string, number>;
  goals: Record<string, number>;
  appliedAt: string;
}
export interface Pagador {
  nome: string;
  cpfCnpj?: string;
  email?: string;
  telefone?: string;
}
export interface Cobranca {
  codigoSolicitacao: string;
  seuNumero: string;
  valorNominal: number;
  dataEmissao: string;
  dataVencimento: string;
  situacao: 'RECEBIDO' | 'A_RECEBER' | 'ATRASADO';
  parcela?: string;
  pagador: Pagador;
  mensagem: string;
}
export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  currencyCode: string;
  date: string;
  category: string;
  type: string;
  status: string;
  merchant?: { name: string };
}

export const MOCK = {
  user: { name: 'Marina Souza', email: 'marina.souza@email.com', cpf: '***.456.789-**', phone: '(11) 98765-4321' },
  pluggy: {
    items: [
      { id: 'item-nu', status: 'UPDATED', connector: { id: 212, name: 'Nubank', primaryColor: '820AD1' }, lastUpdatedAt: '2026-10-16T09:25:00-03:00' },
      { id: 'item-itau', status: 'UPDATED', connector: { id: 201, name: 'Itaú', primaryColor: 'EC7000' }, lastUpdatedAt: '2026-10-16T09:20:00-03:00' },
      { id: 'item-inter', status: 'UPDATING', connector: { id: 215, name: 'Inter', primaryColor: 'FF7A00' }, lastUpdatedAt: '2026-10-16T08:02:00-03:00' },
    ],
    accounts: [
      { id: 'acc-nu', itemId: 'item-nu', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Nubank', number: '0001/1234567-8', balance: 8420.35, owner: 'Marina Souza' },
      { id: 'acc-itau', itemId: 'item-itau', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Itaú Personnalité', number: '1500/98765-4', balance: 12310.9, owner: 'Marina Souza' },
      { id: 'acc-inter', itemId: 'item-inter', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Inter', number: '0001/7654321-0', balance: 3215.4, owner: 'Marina Souza' },
      { id: 'cc-nu', itemId: 'item-nu', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Nubank Ultravioleta', number: '4821', owner: 'MARINA S SOUZA', balance: 2340.1, creditData: { brand: 'MASTERCARD', level: 'BLACK', status: 'ACTIVE', creditLimit: 15000, availableCreditLimit: 12659.9, balanceDueDate: '2026-10-25' } },
      { id: 'cc-itau', itemId: 'item-itau', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Itaú Azul', number: '0937', owner: 'MARINA S SOUZA', balance: 876.45, creditData: { brand: 'VISA', level: 'PLATINUM', status: 'BLOCKED', creditLimit: 8000, availableCreditLimit: 7123.55, balanceDueDate: '2026-11-02' } },
    ],
    transactions: [
      { id: 'tx1', accountId: 'cc-nu', description: 'iFood', amount: -68.9, currencyCode: 'BRL', date: '2026-10-15T20:42:00-03:00', category: 'Delivery', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx2', accountId: 'acc-nu', description: 'Uber', amount: -24.7, currencyCode: 'BRL', date: '2026-10-15T08:15:00-03:00', category: 'Transporte', type: 'DEBIT', status: 'PENDING' },
      { id: 'tx3', accountId: 'cc-nu', description: 'Pão de Açúcar', amount: -312.48, currencyCode: 'BRL', date: '2026-10-14T19:03:00-03:00', category: 'Mercado', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx4', accountId: 'acc-itau', description: 'Enel SP', amount: -187.3, currencyCode: 'BRL', date: '2026-10-14T10:30:00-03:00', category: 'Contas da casa', type: 'DEBIT', status: 'PROCESSING' },
      { id: 'tx5', accountId: 'cc-itau', description: 'Netflix', amount: -55.9, currencyCode: 'BRL', date: '2026-10-13T06:00:00-03:00', category: 'Assinaturas', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx6', accountId: 'cc-nu', description: 'Rappi', amount: -92.4, currencyCode: 'BRL', date: '2026-10-12T21:18:00-03:00', category: 'Delivery', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx7', accountId: 'cc-nu', description: 'Posto Shell', amount: -220.0, currencyCode: 'BRL', date: '2026-10-11T17:45:00-03:00', category: 'Combustível', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx12', accountId: 'cc-nu', description: 'Cinemark', amount: -86.0, currencyCode: 'BRL', date: '2026-10-11T15:20:00-03:00', category: 'Lazer', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx8', accountId: 'acc-nu', description: 'Pix recebido · João Lima', amount: 350.0, currencyCode: 'BRL', date: '2026-10-10T12:04:00-03:00', category: 'Transferência', type: 'CREDIT', status: 'POSTED' },
      { id: 'tx9', accountId: 'acc-inter', description: 'Drogasil', amount: -48.75, currencyCode: 'BRL', date: '2026-10-09T18:22:00-03:00', category: 'Saúde', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx10', accountId: 'cc-nu', description: 'iFood', amount: -54.3, currencyCode: 'BRL', date: '2026-10-08T20:10:00-03:00', category: 'Delivery', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx13', accountId: 'cc-itau', description: 'Spotify', amount: -21.9, currencyCode: 'BRL', date: '2026-10-07T06:00:00-03:00', category: 'Assinaturas', type: 'DEBIT', status: 'POSTED' },
      { id: 'tx11', accountId: 'acc-itau', description: 'Salário · ACME Ltda', amount: 12500.0, currencyCode: 'BRL', date: '2026-10-05T07:00:00-03:00', category: 'Salário', type: 'CREDIT', status: 'POSTED' },
      { id: 'tx14', accountId: 'acc-itau', description: 'Aluguel · Imobiliária Lar', amount: -3200.0, currencyCode: 'BRL', date: '2026-10-05T09:00:00-03:00', category: 'Moradia', type: 'DEBIT', status: 'POSTED' },
    ] as Transaction[],
  },
  brapi: {
    results: [
      { symbol: 'PETR4', longName: 'Petróleo Brasileiro S.A. - Petrobras', regularMarketPrice: 38.42, regularMarketChange: 0.47, regularMarketChangePercent: 1.24 },
      { symbol: 'ITUB4', longName: 'Itaú Unibanco Holding S.A.', regularMarketPrice: 34.87, regularMarketChange: -0.16, regularMarketChangePercent: -0.46 },
      { symbol: 'VALE3', longName: 'Vale S.A.', regularMarketPrice: 61.15, regularMarketChange: 0.5, regularMarketChangePercent: 0.82 },
      { symbol: 'WEGE3', longName: 'WEG S.A.', regularMarketPrice: 52.3, regularMarketChange: -0.58, regularMarketChangePercent: -1.1 },
      { symbol: 'BBAS3', longName: 'Banco do Brasil S.A.', regularMarketPrice: 27.94, regularMarketChange: 0.1, regularMarketChangePercent: 0.35 },
    ],
  },
  holdings: { PETR4: 300, ITUB4: 250, VALE3: 120, WEGE3: 150, BBAS3: 400 } as Record<string, number>,
  allocation: [
    { id: 'acoes', name: 'Ações', color: '#7D39EB', value: 0 },
    { id: 'rf', name: 'Renda fixa', value: 38500, color: '#C6FF33' },
    { id: 'fii', name: 'FIIs', value: 9800, color: '#B18CF7' },
  ],
  serasa: {
    score: { pontuacao: 742 },
    mensagem: 'Pagar a fatura do Nubank até 25 out. mantém seu histórico em dia e pode subir seu score.',
  },
  insights: {
    monthly: [
      { month: '2026-05', income: 13200, expenses: 9800 },
      { month: '2026-06', income: 13450, expenses: 10120 },
      { month: '2026-07', income: 13900, expenses: 8700 },
      { month: '2026-08', income: 13700, expenses: 9950 },
      { month: '2026-09', income: 13720, expenses: 9710 },
      { month: '2026-10', income: 14850, expenses: 9312.47 },
    ],
    invested: { current: 2500, previous: 2173.91 },
    spendingLimit: 12000,
    categories: [
      { id: 'moradia', name: 'Moradia', icon: 'house', color: '#7D39EB', spent: 4200, budget: 4500, count: 3 },
      { id: 'mercado', name: 'Mercado', icon: 'shopping-cart', color: '#C6FF33', spent: 1450.3, budget: 1800, count: 9 },
      { id: 'lazer', name: 'Lazer', icon: 'ticket', color: '#B18CF7', spent: 980, budget: 800, count: 7 },
      { id: 'delivery', name: 'Delivery', icon: 'utensils', color: 'var(--foreground)', spent: 812.6, budget: 600, count: 14 },
      { id: 'transporte', name: 'Transporte', icon: 'car', color: '#E2FF94', spent: 640.2, budget: 1000, count: 18 },
      { id: 'saude', name: 'Saúde', icon: 'heart-pulse', color: '#A1A1AA', spent: 410.5, budget: 600, count: 4 },
      { id: 'assinaturas', name: 'Assinaturas', icon: 'tv', color: '#A1A1AA', spent: 289.7, budget: 300, count: 6 },
      { id: 'outros', name: 'Outros', icon: 'receipt', color: '#A1A1AA', spent: 529.17, budget: 2400, count: 11 },
    ] as Category[],
    categoryTip: 'Delivery passou do limite em R$ 212,60. Cozinhar 2 vezes a mais por semana resolve.',
  },
  bills: [
    { id: 'b1', description: 'Aluguel', category: 'Moradia', icon: 'house', amount: 3200, dueDate: '2026-10-05', status: 'PAID' },
    { id: 'b2', description: 'Condomínio', category: 'Moradia', icon: 'house', amount: 1000, dueDate: '2026-10-10', status: 'PAID' },
    { id: 'b3', description: 'Seguro do carro', category: 'Transporte', icon: 'car', amount: 214.5, dueDate: '2026-10-12', status: 'OVERDUE' },
    { id: 'b4', description: 'Enel · luz', category: 'Contas da casa', icon: 'zap', amount: 187.3, dueDate: '2026-10-14', status: 'PAID' },
    { id: 'b5', description: 'Vivo Fibra', category: 'Contas da casa', icon: 'smartphone', amount: 129.9, dueDate: '2026-10-18', status: 'OPEN' },
    { id: 'b6', description: 'Sabesp · água', category: 'Contas da casa', icon: 'zap', amount: 96.4, dueDate: '2026-10-20', status: 'OPEN' },
    { id: 'b7', description: 'Fatura Nubank', category: 'Cartão', icon: 'credit-card', amount: 2340.1, dueDate: '2026-10-25', status: 'OPEN' },
    { id: 'b8', description: 'Smart Fit', category: 'Saúde', icon: 'heart-pulse', amount: 119.9, dueDate: '2026-10-28', status: 'OPEN' },
  ] as Bill[],
  goals: [
    { id: 'g1', name: 'Viagem para Lisboa', icon: 'plane', target: 15000, saved: 6800, deadline: '2027-06-30' },
    { id: 'g2', name: 'Reserva de emergência', icon: 'shield', target: 30000, saved: 18450, deadline: '2027-12-31' },
    { id: 'g3', name: 'Notebook novo', icon: 'laptop', target: 8000, saved: 5200, deadline: '2026-12-20' },
  ] as Goal[],
  cobranca: [
    { cobranca: { codigoSolicitacao: '6f3e1a2b', seuNumero: 'PLT-0041', valorNominal: 450, dataEmissao: '2026-10-01', dataVencimento: '2026-10-10', situacao: 'RECEBIDO', pagador: { nome: 'Carla Mendes', cpfCnpj: '***.321.654-**' }, mensagem: 'Aulas de inglês · outubro' } },
    { cobranca: { codigoSolicitacao: '8a91c0d4', seuNumero: 'PLT-0042', valorNominal: 1200, dataEmissao: '2026-10-08', dataVencimento: '2026-10-25', situacao: 'A_RECEBER', pagador: { nome: 'Studio Ateliê Ltda', cpfCnpj: '12.345.678/0001-**' }, mensagem: 'Projeto de identidade · 1/2' } },
    { cobranca: { codigoSolicitacao: '2c77e9f1', seuNumero: 'PLT-0039', valorNominal: 280, dataEmissao: '2026-09-25', dataVencimento: '2026-10-05', situacao: 'ATRASADO', pagador: { nome: 'Rafael Costa', cpfCnpj: '***.987.111-**' }, mensagem: 'Revisão de texto' } },
  ] as { cobranca: Cobranca }[],
  plan: null as Plan | null,
};

/** Aplica um plano de orcamento aos limites por categoria (mock de PUT /budgets/{mes}). */
export function applyPlan(plan: Plan | null) {
  if (!plan) return;
  MOCK.insights.categories.forEach((c) => {
    if (plan.budgets[c.id] != null) c.budget = plan.budgets[c.id]!;
  });
  MOCK.insights.spendingLimit = MOCK.insights.categories.reduce((t, c) => t + c.budget, 0);
  MOCK.plan = plan;
}
