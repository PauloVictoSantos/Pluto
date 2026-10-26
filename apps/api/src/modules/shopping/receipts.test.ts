import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';
import { saveReceipt, scanReceipt, shoppingInsights } from './receipts';

// Scanner de cupom e lista de compras (doc. Melhorias, passo 10).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
const KEY = '13261012345678000190650010000012341000012345';
const QR = `https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=${KEY}|2|1|1|ABC`;
const row = (n: number, name: string, qty: string, unit: string, total: string) =>
  `<tr id="Item + ${n}"><td><span class="txtTit">${name}</span><br /><span class="Rqtd"><strong>Qtde.:</strong>${qty}</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;${unit}</span></td><td><span class="valor">${total}</span></td></tr>`;
const page = (date: string, store: string, rows: string, total: string) =>
  `<div id="u20" class="txtTopo">${store}</div><table>${rows}</table><span class="totalNumb">${total}</span><strong> Emissão: </strong>${date} 10:00:00`;
const fakeFetch = (html: string) => (async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
const HTML = page('24/10/2026', 'SUPERMERCADO BOM PRECO', row(1, 'CAFE PILAO TRAD 500G', '1', '16,99', '16,99') + row(2, 'REFRIG COCA COLA 2L', '2', '9,49', '18,98') + row(3, 'BANANA PRATA KG', '1,2', '5,99', '7,19'), '43,16');
const auth = async () => ({ authorization: `Bearer ${await h.token(userId)}` });

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
  h.ctx.llm = null;
  // Lista do mes com "Café" e "Refri" (como o usuario digitou) e "Arroz".
  for (const [raw, category] of [['Café', 'mercearia'], ['Refri', 'bebidas'], ['Arroz', 'mercearia']] as const)
    await h.app.inject({ method: 'POST', url: '/v1/shopping/list/entries', payload: { raw, qty: 1, confirm: { name: raw, category, unit: 'un' } }, headers: await auth() });
});

describe('scanner de cupom', () => {
  it('QR Code: itens oficiais da SEFAZ; salvar risca a lista e liga a compra do banco (Mercado)', async () => {
    const draft = await scanReceipt(h.ctx, userId, { qr: QR }, fakeFetch(HTML));
    expect(draft).toMatchObject({ source: 'sefaz', accessKey: KEY, store: 'SUPERMERCADO BOM PRECO', date: '2026-10-24', totalMinor: 4_316 });
    expect(draft.items.map((i) => i.name)).toEqual(['CAFE PILAO TRAD 500G', 'REFRIG COCA COLA 2L', 'BANANA PRATA KG']);

    // Compra do cartao que chegou pelo Open Finance no mesmo dia, ainda em Outros.
    const { insertedId: txId } = await h.ctx.col.transactions.insertOne({
      userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: 'c1', date: new Date('2026-10-24T15:00:00Z'), description: 'SUPERMERC BOM PRECO',
      descriptionNorm: 'supermerc bom preco', matchKey: 'supermerc bom preco', merchant: null, amountMinor: -4_316, currency: 'BRL', type: 'EXPENSE', status: 'POSTED',
      pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'outros', installment: null, categoryId: null, categorySource: null, categoryConfidence: null,
      invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as never);

    const r = await h.app.inject({ method: 'POST', url: '/v1/shopping/receipts', payload: draft, headers: await auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ transactionId: txId.toHexString(), checkedOff: ['Café', 'Refri'] });
    expect(await h.ctx.col.transactions.findOne({ _id: txId })).toMatchObject({ categoryKey: 'mercado', receiptId: expect.any(ObjectId) });
    const list = (await h.app.inject({ method: 'GET', url: '/v1/shopping/list', headers: await auth() })).json();
    const bought = Object.fromEntries(list.entries.map((e: { name: string; bought: boolean; priceMinor: number | null }) => [e.name, [e.bought, e.priceMinor]]));
    expect(bought).toEqual({ Café: [true, 1_699], Refri: [true, 1_898], Arroz: [false, null] });
    // O mesmo cupom nao entra duas vezes.
    expect((await h.app.inject({ method: 'POST', url: '/v1/shopping/receipts', payload: draft, headers: await auth() })).statusCode).toBe(409);
    await expect(scanReceipt(h.ctx, userId, { qr: QR }, fakeFetch(HTML))).rejects.toMatchObject({ code: 'ALREADY_IMPORTED' });
  });

  it('QR ilegivel: pede a foto, sem erro tecnico', async () => {
    await expect(scanReceipt(h.ctx, userId, { qr: QR }, fakeFetch('<html>captcha</html>'))).rejects.toMatchObject({ code: 'QR_UNREADABLE' });
  });

  it('foto: so com consentimento; a imagem nao fica em lugar nenhum', async () => {
    const MARK = 'IMAGEMSECRETA'.repeat(20);
    const image = { mimeType: 'image/jpeg', base64: Buffer.from(MARK).toString('base64') };
    let r = await h.app.inject({ method: 'POST', url: '/v1/shopping/receipts/scan', payload: { image }, headers: await auth() });
    expect(r.json().error.code).toBe('AI_CONSENT_REQUIRED');

    await h.ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiConsentAt': new Date().toISOString() } });
    let seenImage = '';
    h.ctx.llm = {
      generate: async (input) => {
        seenImage = input.image?.base64 ?? '';
        return JSON.stringify({ estabelecimento: 'MERCADINHO', data: '2026-10-20', itens: [{ nome: 'CAFE MELITTA 500G', quantidade: 1, precoUnitario: 18.5, total: 18.5 }], total: 18.5 });
      },
    };
    r = await h.app.inject({ method: 'POST', url: '/v1/shopping/receipts/scan', payload: { image }, headers: await auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ source: 'ia', store: 'MERCADINHO', totalMinor: 1_850, items: [{ name: 'CAFE MELITTA 500G', unitPriceMinor: 1_850 }] });
    expect(seenImage).toBe(image.base64);
    await h.app.inject({ method: 'POST', url: '/v1/shopping/receipts', payload: r.json(), headers: await auth() });
    // Nenhum documento do banco guarda a imagem (nem em base64).
    for (const c of await h.db.collections()) {
      const docs = JSON.stringify(await c.find({}).toArray());
      expect(docs).not.toContain(image.base64.slice(0, 40));
      expect(docs).not.toContain('IMAGEMSECRETA');
    }
  });
});

describe('lista: sugestoes pelo historico', () => {
  it('frequencia, ultima compra, preco medio e onde saiu mais barato', async () => {
    const now = new Date('2026-10-25T15:00:00Z');
    const draft = (date: string, store: string, price: number) => ({
      store, date, totalMinor: price, source: 'ia' as const, accessKey: null, items: [{ name: 'CAFE PILAO 500G', qty: 1, unitPriceMinor: price, totalMinor: price }],
    });
    await saveReceipt(h.ctx, userId, draft('2026-09-26', 'ATACADAO', 1_590), now);
    await saveReceipt(h.ctx, userId, draft('2026-10-11', 'CARREFOUR', 1_799), now);
    const ins = await shoppingInsights(h.ctx, userId, now);
    const cafe = ins.find((i) => i.name === 'Café')!;
    expect(cafe).toMatchObject({ everyDays: 15, lastDaysAgo: 14, due: true, avgUnitPriceMinor: 1_695, cheapest: { store: 'ATACADAO', unitPriceMinor: 1_590 }, purchases: 2 });
  });
});
