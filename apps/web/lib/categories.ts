// Categorias do Pluggy (em ingles) -> rotulo e icone em portugues. Provisorio: o pipeline de
// categorizacao (RN-10) vai atribuir categorias proprias do Pluto.
const MAP: [RegExp, string, string][] = [
  [/food delivery/i, 'Delivery', 'utensils'],
  [/groceries|supermarket/i, 'Mercado', 'shopping-cart'],
  [/eating out|restaurant|bars?\b/i, 'Restaurantes', 'utensils'],
  [/gas station|fuel/i, 'Combustível', 'fuel'],
  [/taxi|ride|transport|parking|toll|public transportation/i, 'Transporte', 'car'],
  [/pharmac|drugstore/i, 'Farmácia', 'heart-pulse'],
  [/health|hospital|clinic|dentist|gym|fitness/i, 'Saúde', 'heart-pulse'],
  [/streaming|subscription|digital services/i, 'Assinaturas', 'tv'],
  [/telecom|internet|mobile|phone/i, 'Telefone e internet', 'smartphone'],
  [/electricity|water|utilities|gas\b/i, 'Contas da casa', 'zap'],
  [/rent|housing|condominium|mortgage/i, 'Moradia', 'house'],
  [/credit card payment/i, 'Pagamento de fatura', 'credit-card'],
  [/same person transfer/i, 'Entre minhas contas', 'arrow-left-right'],
  [/transfer|pix|ted|doc\b/i, 'Transferência', 'arrow-left-right'],
  [/salary|wage|payroll/i, 'Salário', 'briefcase'],
  [/invest/i, 'Investimentos', 'trending-up'],
  [/income|interest|dividend|refund|cashback/i, 'Entradas', 'arrow-down-left'],
  [/entertainment|leisure|cinema|tickets|games/i, 'Lazer', 'ticket'],
  [/travel|airline|hotel|lodging/i, 'Viagem', 'plane'],
  [/education|school|course|books/i, 'Educação', 'file-text'],
  [/insurance/i, 'Seguros', 'shield'],
  [/tax|fee|bank fees|interest charge/i, 'Taxas e tarifas', 'receipt'],
  [/shopping|clothing|electronics|online/i, 'Compras', 'shopping-cart'],
];

export function categoryOf(providerCategory: string | null): { label: string; icon: string } {
  if (!providerCategory) return { label: 'Sem categoria', icon: 'receipt' };
  const hit = MAP.find(([re]) => re.test(providerCategory));
  return hit ? { label: hit[1], icon: hit[2] } : { label: providerCategory, icon: 'receipt' };
}
