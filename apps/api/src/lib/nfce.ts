import type { ReceiptDraft } from '@pluto/shared';

// NFC-e pelo QR Code (doc. Melhorias, passo 10): o QR traz a URL da consulta publica na SEFAZ do
// estado com a chave de acesso. A pagina oficial lista os itens; o layout padrao (usado por AM, SP,
// RS, BA e outros) tem as classes txtTit / Rqtd / RvlUnit / valor / totalNumb.

/** Chave de acesso (44 digitos) e URL de consulta a partir do texto do QR. */
export function parseNfceQr(text: string): { url: string | null; accessKey: string | null } {
  const t = text.trim();
  const url = /^https?:\/\//i.test(t) ? t : null;
  const digits = (url ? (new URL(url).searchParams.get('p') ?? url) : t).replace(/\|.*$/, '').replace(/\D/g, '');
  const key = /\d{44}/.exec(digits)?.[0] ?? null;
  return { url, accessKey: key };
}

/** So portais oficiais (.gov.br) recebem a requisicao: o QR e texto do usuario, nunca confiavel. */
export function isSefazUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && /\.gov\.br$/i.test(u.hostname) && /(sefaz|fazenda|nfce|sef)/i.test(u.hostname + u.pathname);
  } catch {
    return false;
  }
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
const money = (s: string | undefined) => {
  const m = /(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/.exec(s ?? '');
  return m ? Math.round(Number(`${m[1]!.replace(/\./g, '')}.${m[2]}`) * 100) : 0;
};
const num = (s: string | undefined) => Number((/[\d.,]+/.exec(s ?? '')?.[0] ?? '1').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 1;
const span = (html: string, cls: string) => new RegExp(`<span[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</span>`, 'i').exec(html)?.[1];

/** Itens, loja, data e total da pagina de consulta publica da NFC-e. null se o layout nao bater. */
export function parseNfceHtml(html: string): Omit<ReceiptDraft, 'source' | 'accessKey'> | null {
  const rows = html.split(/<tr[^>]*id="Item\s*\+\s*\d+"[^>]*>/i).slice(1);
  const items = rows
    .map((r) => {
      const name = decode(span(r, 'txtTit') ?? '');
      const qty = num(decode(span(r, 'Rqtd') ?? '').replace(/qtde\.?:/i, ''));
      const unitPriceMinor = money(decode(span(r, 'RvlUnit') ?? ''));
      const totalMinor = money(decode(span(r, 'valor') ?? '')) || Math.round(qty * unitPriceMinor);
      return { name, qty, unitPriceMinor: unitPriceMinor || Math.round(totalMinor / qty), totalMinor };
    })
    .filter((i) => i.name && i.totalMinor > 0);
  if (!items.length) return null;
  const store = decode(/<div[^>]*id="u20"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '') || null;
  const date = /Emiss[aã]o:?\s*<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})|Emiss[aã]o:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(html);
  const ymd = date ? `${date[3] ?? date[6]}-${date[2] ?? date[5]}-${date[1] ?? date[4]}` : null;
  const total = money(decode(span(html, 'totalNumb') ?? '')) || items.reduce((t, i) => t + i.totalMinor, 0);
  return { store: store?.slice(0, 80) ?? null, date: ymd, items, totalMinor: total };
}

/** Busca a pagina da SEFAZ (10 s, ate 2 MB) e le os itens. */
export async function fetchNfce(url: string, fetchImpl: typeof fetch = fetch) {
  if (!isSefazUrl(url)) return null;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 (Pluto)' } });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 2_000_000) return null;
  // Varios portais respondem em ISO-8859-1.
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset).decode(buf);
  } catch {
    html = new TextDecoder('utf-8').decode(buf);
  }
  return parseNfceHtml(html);
}
