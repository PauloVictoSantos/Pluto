// Mock de emissao de boletos (formato FEBRABAN: codigo de barras de 44 digitos, linha digitavel de 47).
import { addMonths, daysBetween, fmt, fmtDayFull } from '../format';
import { MOCK, TODAY, type Cobranca, type Pagador } from './data';

export interface Boleto {
  cobranca: Cobranca;
  boleto: { codigoBarras: string; linhaDigitavel: string };
}

const mod10 = (s: string) => {
  let sum = 0, w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    const p = +s[i]! * w;
    sum += p > 9 ? p - 9 : p;
    w = w === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
};
const mod11 = (s: string) => {
  let sum = 0, w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += +s[i]! * w;
    w = w === 9 ? 2 : w + 1;
  }
  const d = 11 - (sum % 11);
  return d === 0 || d > 9 ? 1 : d;
};

function boletoCodes(valor: number, venc: string, seq: number) {
  const fator = String(1000 + daysBetween('2025-02-22', venc)).padStart(4, '0');
  const v = String(Math.round(valor * 100)).padStart(10, '0');
  const livre = ('0011' + String(31725400 + seq * 977).padStart(11, '0') + '0123456' + String(seq).padStart(3, '0')).slice(0, 25);
  const semDv = '077' + '9' + fator + v + livre, dv = mod11(semDv), bar = semDv.slice(0, 4) + dv + semDv.slice(4);
  const c1 = '0779' + livre.slice(0, 5), c2 = livre.slice(5, 15), c3 = livre.slice(15, 25);
  const f = (c: string, cut: number) => c.slice(0, cut) + '.' + c.slice(cut);
  const linha = `${f(c1 + mod10(c1), 5)} ${f(c2 + mod10(c2), 5)} ${f(c3 + mod10(c3), 5)} ${dv} ${fator}${v}`;
  return { codigoBarras: bar, linhaDigitavel: linha };
}

const ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
export function barcodeBars(code: string) {
  const out: { w: number; c: string }[] = [];
  const push = (w: string, b: boolean) => out.push({ w: w === 'w' ? 3 : 1, c: b ? '#000' : 'transparent' });
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

export interface BoletoRequest {
  valorTotal: number;
  parcelas: number;
  primeiroVencimento: string;
  descricao: string;
  pagador: Pagador;
}

/** Mock de POST /cobranca (uma cobranca por parcela). */
export async function emitBoleto(req: BoletoRequest): Promise<Boleto[]> {
  await new Promise((r) => setTimeout(r, 1300));
  const cents = Math.round(req.valorTotal * 100), base = Math.floor(cents / req.parcelas);
  return Array.from({ length: req.parcelas }, (_, i) => {
    const valor = (i === req.parcelas - 1 ? cents - base * (req.parcelas - 1) : base) / 100;
    const venc = addMonths(req.primeiroVencimento, i), seq = 43 + i;
    return {
      cobranca: {
        codigoSolicitacao: Math.random().toString(16).slice(2, 10), seuNumero: `PLT-${String(seq).padStart(4, '0')}`,
        valorNominal: valor, dataEmissao: TODAY, dataVencimento: venc, situacao: 'A_RECEBER', parcela: `${i + 1}/${req.parcelas}`,
        pagador: req.pagador, mensagem: req.descricao,
      },
      boleto: boletoCodes(valor, venc, seq),
    };
  });
}

// Dados digitados pelo usuario entram no HTML do boleto: escapar sempre (secao 6.7).
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function boletoHtml(list: Boleto[]) {
  const page = (b: Boleto) => {
    const c = b.cobranca;
    const bars = barcodeBars(b.boleto.codigoBarras).map((x) => `<i style="flex:${x.w};background:${x.c}"></i>`).join('');
    return `<section style="page-break-after:always;border:1px solid #000;border-radius:12px;padding:24px;margin:0 0 24px;font-family:Arial,sans-serif;color:#000">
<div style="display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px"><b style="font-size:18px">Pluto Pagamentos | 077-9</b><span style="font-family:monospace;font-size:15px">${b.boleto.linhaDigitavel}</span></div>
<table style="width:100%;font-size:13px;border-collapse:collapse"><tr><td><small>Beneficiário</small><br><b>${esc(MOCK.user.name)}</b></td><td><small>Vencimento</small><br><b>${fmtDayFull(c.dataVencimento)}</b></td><td><small>Valor</small><br><b>${fmt(c.valorNominal)}</b></td></tr>
<tr><td style="padding-top:10px"><small>Pagador</small><br><b>${esc(c.pagador.nome)}</b> ${esc(c.pagador.cpfCnpj || '')}</td><td style="padding-top:10px"><small>Parcela</small><br><b>${c.parcela || '1/1'}</b></td><td style="padding-top:10px"><small>Nosso número</small><br><b>${c.seuNumero}</b></td></tr></table>
${c.mensagem ? `<p style="font-size:13px">${esc(c.mensagem)}</p>` : ''}<div style="display:flex;height:60px;margin-top:16px">${bars}</div></section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Boleto ${list[0]!.cobranca.seuNumero}</title></head><body style="margin:24px">${list.map(page).join('')}<script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`;
}

/** Abre o boleto numa nova aba com o dialogo de impressao (salvar como PDF). */
export function downloadBoleto(list: Boleto[]) {
  const url = URL.createObjectURL(new Blob([boletoHtml(list)], { type: 'text/html' }));
  if (!window.open(url, '_blank')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `boleto-${list[0]!.cobranca.seuNumero}.html`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function boletoMessage(list: Boleto[]) {
  const c = list[0]!.cobranca, n = list.length;
  const lines = list
    .map((b) => `${b.cobranca.parcela || '1/1'} · ${fmt(b.cobranca.valorNominal)} · vence ${fmtDayFull(b.cobranca.dataVencimento)}\n${b.boleto.linhaDigitavel}`)
    .join('\n\n');
  return `Olá, ${c.pagador.nome.split(' ')[0]}! Segue${n > 1 ? 'm os boletos' : ' o boleto'} de ${MOCK.user.name}${c.mensagem ? ` (${c.mensagem})` : ''}:\n\n${lines}`;
}
