import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';
import { autoCategorize, buildCategorizer } from './categorizer';
import { patterns } from './patterns';

// Fase 4: padroes de gasto, anomalias e categorizacao aprendida.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const NOW = new Date('2026-10-16T15:00:00Z');
const DAY = 86_400_000;
let userId: ObjectId;
let seq = 0;

const tx = (date: Date, amountMinor: number, over: Record<string, unknown> = {}) => ({
  userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `p${seq++}`, date, description: 'COMPRA', descriptionNorm: 'compra',
  matchKey: 'compra', merchant: null, amountMinor, currency: 'BRL', type: amountMinor > 0 ? 'INCOME' : 'EXPENSE', status: 'POSTED', pluggyCategory: null,
  pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'outros', installment: null, categoryId: null, categorySource: null, categoryConfidence: null,
  invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: true, counterpartyKey: null, createdAt: NOW, updatedAt: NOW, ...over,
});
const req = async (method: 'GET' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });

describe('categorizacao aprendida (RN-D01, RN-I04)', () => {
  async function seedLabeled(n: number) {
    const kinds = [
      { key: 'educacao', words: 'faculdade norte mensalidade' },
      { key: 'delivery', words: 'ifood restaurante pedido' },
      { key: 'transporte', words: 'uber viagem corrida' },
    ];
    const docs = Array.from({ length: n }, (_, i) => {
      const k = kinds[i % 3]!;
      return tx(new Date(NOW.getTime() - (i + 1) * DAY), -1000 - i, { matchKey: k.words, descriptionNorm: k.words, categoryKey: k.key, categorySource: 'MANUAL' });
    });
    await h.ctx.col.transactions.insertMany(docs as never);
  }

  it('aplica sozinho com confianca alta, nunca toca a escolha do usuario e desliga com poucos exemplos', async () => {
    userId = (await h.createUser()).id;
    await seedLabeled(5);
    expect((await buildCategorizer(h.ctx.col, userId)).enabled).toBe(false);

    await seedLabeled(40);
    const status = await buildCategorizer(h.ctx.col, userId);
    expect(status.enabled).toBe(true);
    expect(status.f1).toBeGreaterThanOrEqual(0.85);

    const { insertedId: newTx } = await h.ctx.col.transactions.insertOne(
      tx(new Date(NOW.getTime() - DAY), -45_000, { matchKey: 'faculdade norte', descriptionNorm: 'pix enviado faculdade norte', pluggyCategory: 'Transfer - PIX', categoryKey: 'outros' }) as never,
    );
    const r = await autoCategorize(h.ctx.col, userId, NOW);
    expect(r.applied).toBeGreaterThan(0);
    const t = await h.ctx.col.transactions.findOne({ _id: newTx });
    expect(t).toMatchObject({ categoryKey: 'educacao', categorySource: 'AI' });
    expect(t!.categoryConfidence).toBeGreaterThanOrEqual(0.9);
    // As correcoes do usuario continuam como estao.
    expect(await h.ctx.col.transactions.countDocuments({ userId, categorySource: 'MANUAL' })).toBe(45);

    // Sem exemplos (modelo desligado): volta para a categoria do Pluggy.
    await h.ctx.col.transactions.deleteMany({ userId, categorySource: 'MANUAL' });
    await autoCategorize(h.ctx.col, userId, NOW);
    expect(await h.ctx.col.transactions.findOne({ _id: newTx })).toMatchObject({ categoryKey: 'outros', categorySource: null });
  });
});

describe('gasto fora do normal (RN-D05)', () => {
  it('sinaliza so o gasto isolado e nao esconde nada', async () => {
    userId = (await h.createUser()).id;
    const normal = [5000, 5200, 4800, 5100, 4900, 5300, 5000, 4700, 5050, 4950];
    await h.ctx.col.transactions.insertMany(
      [...normal.map((v, i) => tx(new Date(NOW.getTime() - (i + 2) * DAY), -v, { categoryKey: 'delivery' })), tx(new Date(NOW.getTime() - DAY), -45_000, { categoryKey: 'delivery' })] as never,
    );
    const list = (await req('GET', '/v1/transactions')).json();
    expect(list.items).toHaveLength(11);
    const flagged = list.items.filter((t: { outlier: unknown }) => t.outlier);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ amountMinor: -45_000, outlier: { medianMinor: 5000 } });
  });
});

describe('padroes de gasto', () => {
  it('acha o pico de sexta a noite, ignora horario falso e detecta a subida de patamar', async () => {
    userId = (await h.createUser()).id;
    const docs = [];
    for (let w = 0; w < 20; w++) {
      const base = NOW.getTime() - (w * 7 + 1) * DAY;
      // Sexta 19h em Manaus (23h UTC): delivery, mais caro nas ultimas 4 semanas.
      const friday = new Date(base - ((new Date(base).getUTCDay() + 2) % 7) * DAY);
      friday.setUTCHours(23, 10, 0, 0);
      for (let k = 0; k < 3; k++) docs.push(tx(new Date(friday.getTime() + k * 60_000), w < 4 ? -9_000 : -3_000, { categoryKey: 'delivery' }));
      // Um gasto por dia em horarios espalhados.
      for (let d = 0; d < 7; d++) docs.push(tx(new Date(base - d * DAY - (((w * 7 + d) * 5) % 24) * 3_600_000 - 7 * 60_000), -2_000, { categoryKey: 'mercado' }));
      // Pendente de cartao com hora falsa (23:00): fora do mapa.
      docs.push(tx(new Date(Math.floor(base / DAY) * DAY + 23 * 3_600_000), -1_000, { hasTime: false, categoryKey: 'compras' }));
    }
    await h.ctx.col.transactions.insertMany(docs as never);

    const p = await patterns(h.ctx, userId, NOW);
    expect(p.status).toBe('ready');
    expect(p.weeks).toBe(13);
    const peaks = p.cells.filter((c) => c.peak);
    expect(peaks).toEqual([expect.objectContaining({ dow: 5, band: 4 })]);
    expect(p.conclusion).toMatch(/^Sexta entre 16h e 20h concentra \d+% .*principalmente delivery/);
    expect(p.untimedShare).toBeGreaterThan(0);
    expect(p.categories[0]!.categoryKey).toBe('delivery');
    expect(p.shifts).toEqual([expect.objectContaining({ categoryKey: 'delivery', weeksAgo: 3 })]);
    expect(p.categorizer.enabled).toBe(false);
  });

  it('menos de 8 semanas: nao afirma padrao nenhum (RN-D04)', async () => {
    userId = (await h.createUser()).id;
    await h.ctx.col.transactions.insertMany(Array.from({ length: 30 }, (_, i) => tx(new Date(NOW.getTime() - i * 3_600_000 * 7), -1000)) as never);
    const p = await patterns(h.ctx, userId, NOW);
    expect(p).toMatchObject({ status: 'learning', conclusion: null });
    expect(p.cells.some((c) => c.peak)).toBe(false);
    expect(p.needWeeks).toBeGreaterThan(0);
  });
});
