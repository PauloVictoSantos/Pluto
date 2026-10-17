// Chat da Pluto (mock). Producao: POST /v1/insights/chat -> API do LLM com dados minimizados (secao 5.7).
import { fmt, fmtDate } from '../format';
import { MOCK } from './data';
import { vm } from './vm';

export async function askPluto(question: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 1100));
  const q = question.toLowerCase(), cat = MOCK.insights.categories;
  if (q.includes('delivery') || q.includes('ifood')) {
    const d = cat.find((c) => c.id === 'delivery')!;
    return `Em outubro você gastou ${fmt(d.spent)} com delivery, em ${d.count} pedidos. Isso passa ${fmt(d.spent - d.budget)} do limite que você definiu.`;
  }
  if (q.includes('categoria') || q.includes('mais gast')) {
    const t = [...cat].sort((a, b) => b.spent - a.spent).slice(0, 3);
    return `Suas 3 maiores categorias em outubro: ${t.map((c) => `${c.name} (${fmt(c.spent)})`).join(', ')}.`;
  }
  if (q.includes('maior')) {
    const m = MOCK.pluggy.transactions.filter((t) => t.amount < 0).sort((a, b) => a.amount - b.amount)[0]!;
    return `Seu maior gasto recente foi ${fmt(Math.abs(m.amount))} em ${m.description}, em ${fmtDate(m.date)}.`;
  }
  if (q.includes('score')) return `Seu score Serasa está em ${MOCK.serasa.score.pontuacao}, na faixa Excelente. ${MOCK.serasa.mensagem}`;
  if (q.includes('saldo')) return `Somando suas 3 contas conectadas, seu saldo é de ${fmt(vm.total())}.`;
  if (q.includes('boleto'))
    return 'Na aba Boleto você informa quanto quer receber e em quantas parcelas. Eu gero os boletos e você manda por WhatsApp ou e-mail.';
  if (q.includes('conta') || q.includes('vence')) {
    const o = MOCK.bills.filter((b) => b.status !== 'PAID');
    return `Você tem ${o.length} contas em aberto este mês, somando ${fmt(o.reduce((t, b) => t + b.amount, 0))}. O seguro do carro está atrasado.`;
  }
  return 'Ainda estou aprendendo sobre isso. Posso falar sobre gastos por categoria, saldo, contas a pagar, cartões, boletos ou score.';
}
