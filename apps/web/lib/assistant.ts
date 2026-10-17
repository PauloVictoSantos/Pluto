import { CATEGORIES, categoryOf } from '@pluto/shared';
import { api } from './api';
import { fmtDay, fmtRaw } from './format';
import { nextDue } from './insights';
import { monthLower } from './queries';

// O chat mostra o valor que a pessoa perguntou, mesmo com valores ocultos na tela.
const money = (minor: number) => fmtRaw(minor / 100);

// Respostas da Pluto. Com LLM configurado na API (secao 5.7), a API calcula os numeros e o
// modelo so os explica. Sem LLM (ou se ele falhar), respostas por regras sobre os dados reais.

export type ChatTurn = { role: 'user' | 'pluto'; text: string };

export async function askPluto(question: string, todayYmd: string, history: ChatTurn[] = []): Promise<string> {
  try {
    const { answer } = await api.ask(question, history.slice(-8).map((h) => ({ role: h.role, text: h.text.slice(0, 1500) })));
    // O balao e texto puro: tira o markdown que o modelo costuma usar.
    return answer.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[*-]\s+/gm, '• ');
  } catch {
    return askByRules(question, todayYmd);
  }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function askByRules(question: string, todayYmd: string): Promise<string> {
  const q = norm(question);
  try {
    // Gasto numa categoria especifica ("quanto gastei com delivery/mercado/uber...")
    const cat = CATEGORIES.find((c) => c.group !== 'internal' && q.includes(norm(c.label).split(' ')[0]!)) ??
      (q.includes('uber') || q.includes('99') ? categoryOf('transporte') : q.includes('ifood') ? categoryOf('delivery') : undefined);
    if (cat && /gast|quanto/.test(q)) {
      const sp = await api.spending();
      const c = sp.categories.find((x) => x.key === cat.key);
      return c
        ? `Em ${monthLower(sp.month)} você gastou ${money(c.spentMinor)} com ${cat.label.toLowerCase()}, em ${c.count} lançamento${c.count > 1 ? 's' : ''}. Isso é ${Math.round((c.spentMinor / sp.totalMinor) * 100)}% dos seus gastos do mês.`
        : `Não encontrei gastos com ${cat.label.toLowerCase()} em ${monthLower(sp.month)}.`;
    }
    if (/categoria|mais gast|onde.*gast/.test(q)) {
      const sp = await api.spending();
      if (!sp.categories.length) return `Ainda não há gastos registrados em ${monthLower(sp.month)}.`;
      const top = sp.categories.slice(0, 3).map((c) => `${categoryOf(c.key).label} (${money(c.spentMinor)})`);
      return `Suas maiores categorias em ${monthLower(sp.month)}: ${top.join(', ')}. No total foram ${money(sp.totalMinor)}.`;
    }
    if (/saldo|quanto tenho|dinheiro/.test(q)) {
      const s = await api.summary();
      const parts = s.banks.map((b) => `${b.institutionName.replace(/\s+INSTITUI.*$/i, '')}: ${money(b.balanceMinor)}`);
      return `Somando conta corrente e poupança, você tem ${money(s.balanceMinor)}${parts.length ? ` (${parts.join('; ')})` : ''}.`;
    }
    if (/fatura|cartao|vence|conta.*pagar|pagar/.test(q)) {
      const cards = await api.cards();
      if (!cards.length) return 'Não encontrei cartões de crédito nas suas contas conectadas.';
      const lines = cards
        .filter((c) => c.currentBillMinor > 0)
        .map((c) => `${c.name}: ${money(c.currentBillMinor)}${c.dueDay ? `, vence ${fmtDay(nextDue(c.dueDay, todayYmd))}` : ''}`);
      const overdue = cards.filter((c) => c.invoice?.status === 'OVERDUE').map((c) => c.name);
      return (
        (lines.length ? `Faturas atuais — ${lines.join('; ')}.` : 'Nenhuma fatura em aberto agora.') +
        (overdue.length ? ` Atenção: a última fatura de ${overdue.join(', ')} consta como não paga.` : '')
      );
    }
    if (/receb|receita|renda|salario|ganhei/.test(q)) {
      const s = await api.summary();
      return `Em ${monthLower(s.current.month)} entraram ${money(s.current.incomeMinor)}; em ${monthLower(s.previous.month)} foram ${money(s.previous.incomeMinor)}. Transferências entre suas contas não contam.`;
    }
    if (/sobr|economiz|poupe|guardei|mes/.test(q)) {
      const s = await api.summary();
      const left = s.current.incomeMinor - s.current.expensesMinor;
      return `Em ${monthLower(s.current.month)}: entraram ${money(s.current.incomeMinor)} e saíram ${money(s.current.expensesMinor)} em gastos, ${left >= 0 ? `sobrando ${money(left)}` : `faltando ${money(-left)}`}.`;
    }
    if (/meta/.test(q)) {
      const goals = await api.goals();
      if (!goals.length) return 'Você ainda não tem metas. Crie uma na tela Metas e eu acompanho com você.';
      return goals.map((g) => `${g.name}: ${money(g.savedMinor)} de ${money(g.targetMinor)} (${Math.round((g.savedMinor / g.targetMinor) * 100)}%)`).join('; ') + '.';
    }
  } catch {
    return 'Não consegui consultar seus dados agora. A API está rodando?';
  }
  return 'Ainda não sei responder isso. Posso falar sobre saldo, gastos do mês e por categoria (ex.: delivery, mercado, transporte), faturas, receitas e metas.';
}
