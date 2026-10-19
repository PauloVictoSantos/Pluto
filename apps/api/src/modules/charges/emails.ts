import { formatBoletoLine } from '@pluto/shared';
import type { ChargeDoc, InstallmentDoc } from '../../db/collections';

// E-mails ao pagador (Resend). Nome, descricao e afins vem do usuario: sempre escapados no HTML.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const brl = (minor: number) => (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const day = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const parcel = (c: ChargeDoc, i: InstallmentDoc) => (c.installments.length > 1 ? ` · parcela ${i.n}/${c.installments.length}` : '');

function layout(title: string, body: string) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F2F8;font-family:Arial,Helvetica,sans-serif;color:#14101F">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#FFFFFF;border-radius:16px;padding:24px;border:1px solid #E4E4E7">
<div style="font-size:20px;font-weight:700;margin:0 0 12px">${title}</div>
${body}
</div>
<div style="font-size:12px;color:#6B6B73;text-align:center;margin-top:16px">Enviado pelo Pluto em nome de quem emitiu a cobrança. Dúvidas? Responda este e-mail.</div>
</div></body></html>`;
}

/** Boletos em aberto da cobranca, com valor, vencimento, linha digitavel e links do Stripe. */
export function boletoEmail(c: ChargeDoc, items: InstallmentDoc[], beneficiary: string) {
  const first = c.payerName.split(' ')[0]!;
  const what = c.description || 'cobrança';
  const total = items.reduce((s, i) => s + i.amountMinor, 0);
  const subject = items.length === 1 ? `Boleto de ${brl(items[0]!.amountMinor)} · vence ${day(items[0]!.dueDate)}` : `${items.length} boletos de ${esc(beneficiary)} · total ${brl(total)}`;
  const blocks = items.map(
    (i) => `<div style="border:1px solid #E4E4E7;border-radius:12px;padding:14px;margin:12px 0">
<div style="font-size:18px;font-weight:700">${brl(i.amountMinor)}</div>
<div style="font-size:13px;color:#6B6B73;margin:2px 0 10px">${esc(what)}${parcel(c, i)} · vence em ${day(i.dueDate)}</div>
<div style="font-size:12px;color:#6B6B73">Linha digitável</div>
<div style="font-family:Consolas,Menlo,monospace;font-size:14px;background:#F4F4F5;border-radius:8px;padding:8px 10px;margin:4px 0 12px;word-break:break-all">${esc(formatBoletoLine(i.number ?? ''))}</div>
${i.voucherUrl ? `<a href="${esc(i.voucherUrl)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:700;margin-right:8px">Ver boleto</a>` : ''}
${i.pdfUrl ? `<a href="${esc(i.pdfUrl)}" style="display:inline-block;color:#7D39EB;font-size:14px;font-weight:700">Baixar PDF</a>` : ''}
</div>`,
  );
  const html = layout(
    'Seu boleto chegou',
    `<p style="margin:0 0 4px;font-size:15px">Olá, ${esc(first)}!</p>
<p style="margin:0;font-size:15px">${esc(beneficiary)} enviou ${items.length === 1 ? 'um boleto' : `${items.length} boletos`} de ${esc(what)}.</p>${blocks.join('')}
<p style="font-size:13px;color:#6B6B73;margin:8px 0 0">Pague em qualquer banco, lotérica ou app, até o vencimento.</p>`,
  );
  const text = [
    `Olá, ${first}!`,
    `${beneficiary} enviou ${items.length === 1 ? 'um boleto' : `${items.length} boletos`} de ${what}.`,
    ...items.map((i) => [`${brl(i.amountMinor)}${parcel(c, i)} · vence em ${day(i.dueDate)}`, `Linha digitável: ${formatBoletoLine(i.number ?? '')}`, i.voucherUrl ? `Boleto: ${i.voucherUrl}` : ''].filter(Boolean).join('\n')),
  ].join('\n\n');
  return { subject, html, text };
}

/** Aviso de cancelamento: o boleto nao deve mais ser pago. */
export function cancellationEmail(c: ChargeDoc, items: InstallmentDoc[], beneficiary: string) {
  const first = c.payerName.split(' ')[0]!;
  const what = c.description || 'cobrança';
  const one = items.length === 1;
  const subject = one ? `Boleto cancelado · ${brl(items[0]!.amountMinor)} · vencimento ${day(items[0]!.dueDate)}` : `${items.length} boletos cancelados · ${esc(beneficiary)}`;
  const list = items
    .map((i) => `<li style="margin:4px 0"><s>${brl(i.amountMinor)}</s> · ${esc(what)}${parcel(c, i)} · vencimento ${day(i.dueDate)}</li>`)
    .join('');
  const html = layout(
    one ? 'Boleto cancelado' : 'Boletos cancelados',
    `<p style="margin:0 0 4px;font-size:15px">Olá, ${esc(first)}!</p>
<p style="margin:0 0 8px;font-size:15px">${esc(beneficiary)} cancelou ${one ? 'o boleto abaixo' : 'os boletos abaixo'}. <b>Não pague ${one ? 'este boleto' : 'estes boletos'}</b>: o banco vai recusar.</p>
<ul style="padding-left:18px;font-size:14px;color:#3F3F46">${list}</ul>`,
  );
  const text = [
    `Olá, ${first}!`,
    `${beneficiary} cancelou ${one ? 'o boleto abaixo' : 'os boletos abaixo'}. Não pague: o banco vai recusar.`,
    ...items.map((i) => `- ${brl(i.amountMinor)} · ${what}${parcel(c, i)} · vencimento ${day(i.dueDate)}`),
  ].join('\n');
  return { subject, html, text };
}
