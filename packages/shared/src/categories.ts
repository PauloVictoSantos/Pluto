// Categorias do Pluto derivadas da categoria do Pluggy (em ingles). Provisorio ate o pipeline
// de categorizacao com regras do usuario (RN-10/RN-12). A API grava `categoryKey` em cada
// transacao; os graficos, orcamentos e o planejamento agrupam por ela.

export type CategoryGroup = 'essential' | 'lifestyle' | 'income' | 'internal';

export interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  group: CategoryGroup;
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'moradia', label: 'Moradia', icon: 'house', color: '#7D39EB', group: 'essential' },
  { key: 'mercado', label: 'Mercado', icon: 'shopping-cart', color: '#C6FF33', group: 'essential' },
  { key: 'contas-casa', label: 'Contas da casa', icon: 'zap', color: '#B18CF7', group: 'essential' },
  { key: 'telefone', label: 'Telefone e internet', icon: 'smartphone', color: '#9A68F2', group: 'essential' },
  { key: 'transporte', label: 'Transporte', icon: 'car', color: '#E2FF94', group: 'essential' },
  { key: 'combustivel', label: 'Combustível', icon: 'fuel', color: '#5A22B8', group: 'essential' },
  { key: 'saude', label: 'Saúde', icon: 'heart-pulse', color: '#A1E3B5', group: 'essential' },
  { key: 'educacao', label: 'Educação', icon: 'file-text', color: '#6A2AD6', group: 'essential' },
  { key: 'seguros', label: 'Seguros', icon: 'shield', color: '#8FBF12', group: 'essential' },
  { key: 'dividas', label: 'Dívidas e empréstimos', icon: 'landmark', color: '#B91C1C', group: 'essential' },
  { key: 'taxas', label: 'Taxas, juros e IOF', icon: 'receipt', color: '#EF4444', group: 'essential' },
  { key: 'delivery', label: 'Delivery', icon: 'utensils', color: '#000000', group: 'lifestyle' },
  { key: 'restaurantes', label: 'Restaurantes', icon: 'utensils', color: '#F59E0B', group: 'lifestyle' },
  { key: 'compras', label: 'Compras', icon: 'shopping-cart', color: '#EC4899', group: 'lifestyle' },
  { key: 'lazer', label: 'Lazer', icon: 'ticket', color: '#06B6D4', group: 'lifestyle' },
  { key: 'assinaturas', label: 'Assinaturas', icon: 'tv', color: '#64748B', group: 'lifestyle' },
  { key: 'viagem', label: 'Viagem', icon: 'plane', color: '#0EA5E9', group: 'lifestyle' },
  { key: 'pix-enviado', label: 'Pix e transferências', icon: 'arrow-left-right', color: '#A1A1AA', group: 'lifestyle' },
  { key: 'outros', label: 'Outros', icon: 'receipt', color: '#D4D4D8', group: 'lifestyle' },
  { key: 'salario', label: 'Salário', icon: 'briefcase', color: '#7D39EB', group: 'income' },
  { key: 'rendimentos', label: 'Rendimentos', icon: 'trending-up', color: '#C6FF33', group: 'income' },
  { key: 'entradas', label: 'Outras entradas', icon: 'arrow-down-left', color: '#B18CF7', group: 'income' },
  { key: 'entre-contas', label: 'Entre minhas contas', icon: 'arrow-left-right', color: '#A1A1AA', group: 'internal' },
  { key: 'fatura', label: 'Pagamento de fatura', icon: 'credit-card', color: '#A1A1AA', group: 'internal' },
  { key: 'investimentos', label: 'Investimentos', icon: 'piggy-bank', color: '#7D39EB', group: 'internal' },
  // Pagamento que foi dividido entre as compras de uma divida (as partes e que contam como gasto).
  { key: 'pago-dividido', label: 'Pagamento dividido', icon: 'layout-grid', color: '#A1A1AA', group: 'internal' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export const CATEGORY_BY_KEY: Record<string, CategoryDef> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// Ordem importa: a primeira regra que casar vence.
const RULES: [RegExp, string][] = [
  [/credit card payment/i, 'fatura'],
  [/same person transfer/i, 'entre-contas'],
  [/^investments?\b/i, 'investimentos'],
  [/salary|wage|payroll/i, 'salario'],
  [/proceeds|interests? and dividends|dividend|yield/i, 'rendimentos'],
  [/government aid|^income\b|refund|cashback/i, 'entradas'],
  // \btax(es)?\b: "Taxi" nao e taxa.
  [/loans?\b|financing|debt/i, 'dividas'],
  [/late payment|overdraft|interests? charged|tax on financial|bank fees|credit card fees|\bfees?\b|\btax(es)?\b/i, 'taxas'],
  [/food delivery/i, 'delivery'],
  [/groceries|supermarket/i, 'mercado'],
  [/eating out|restaurant|food and drinks|bars?\b|coffee/i, 'restaurantes'],
  [/gas station|fuel/i, 'combustivel'],
  [/taxi|ride|transport|parking|toll|automotive|vehicle/i, 'transporte'],
  [/pharmac|drugstore|health|hospital|clinic|dentist|gym|fitness/i, 'saude'],
  [/streaming|digital services|subscription|software/i, 'assinaturas'],
  [/telecom|internet|mobile|phone/i, 'telefone'],
  [/electricity|water|utilities|\bgas\b/i, 'contas-casa'],
  [/rent|housing|condominium|mortgage|houseware/i, 'moradia'],
  [/university|education|school|course|bookstore|books/i, 'educacao'],
  [/insurance/i, 'seguros'],
  [/travel|airline|hotel|lodging/i, 'viagem'],
  [/tickets|cinema|theater|concert|leisure|entertainment|games/i, 'lazer'],
  [/shopping|clothing|electronics|online|services/i, 'compras'],
  [/transfer|pix|bank slip|ted\b|doc\b|cash/i, 'pix-enviado'],
];

/** Categoria do Pluto para uma transacao. `amountMinor` decide entre entrada e saida. */
export function categoryKeyFor(providerCategory: string | null | undefined, amountMinor: number): string {
  const key = providerCategory ? RULES.find(([re]) => re.test(providerCategory))?.[1] : undefined;
  if (key) {
    const group = CATEGORY_BY_KEY[key]!.group;
    // Pix/transferencia recebida e entrada; "rendimento" negativo e taxa.
    if (amountMinor > 0 && group === 'lifestyle') return 'entradas';
    if (amountMinor < 0 && group === 'income') return 'outros';
    return key;
  }
  return amountMinor > 0 ? 'entradas' : 'outros';
}

export const categoryOf = (key: string | null | undefined): CategoryDef => CATEGORY_BY_KEY[key ?? ''] ?? CATEGORY_BY_KEY.outros!;
