import { formatBoletoLine, type Charge, type Installment } from '@pluto/shared';
import { fmtDay } from './format';
import { money } from './queries';

// Codigo de barras do boleto (padrao Febraban: Interleaved 2 of 5 com 44 digitos).
const ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

export function barcodeBars(code: string) {
  const out: { w: number; c: string }[] = [];
  const push = (w: string, black: boolean) => out.push({ w: w === 'w' ? 3 : 1, c: black ? '#000' : 'transparent' });
  ['n', 'n', 'n', 'n'].forEach((w, i) => push(w, i % 2 === 0));
  for (let i = 0; i < code.length; i += 2) {
    const a = ITF[+code[i]!]!, b = ITF[+code[i + 1]!]!;
    for (let k = 0; k < 5; k++) {
      push(a[k]!, true);
      push(b[k]!, false);
    }
  }
  push('w', true);
  push('n', false);
  push('n', true);
  return out;
}

const payable = (i: Installment) => i.status === 'OPEN' && !!i.number;

/** Texto para WhatsApp/e-mail: parcelas em aberto com linha digitavel e link do boleto. */
export function chargeMessage(c: Charge, only?: Installment): string {
  const first = c.payerName.split(' ')[0];
  const list = (only ? [only] : c.installments).filter(payable);
  const what = c.description || 'cobrança';
  const lines = list.map((i) => {
    const parc = c.installments.length > 1 ? ` · parcela ${i.n}/${c.installments.length}` : '';
    return [`${money(i.amountMinor)}${parc} · vence ${fmtDay(i.dueDate)}`, `Linha digitável: ${formatBoletoLine(i.number!)}`, i.voucherUrl ? `Boleto: ${i.voucherUrl}` : ''].filter(Boolean).join('\n');
  });
  return [`Olá, ${first}! Segue o boleto de ${what}:`, ...lines].join('\n\n');
}
