import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.reset();
  h.ctx.llm = null;
});

async function seed() {
  const userId = (await h.createUser()).id;
  const now = new Date(), conn = new ObjectId(), acc = new ObjectId();
  await h.ctx.col.connections.insertOne({
    _id: conn, userId, pluggyItemIdEnc: 'v1.x', pluggyItemIdHash: 'h', source: 'MEU_PLUGGY', connectorId: 200, institutionName: 'Banco Bradesco',
    imageUrl: null, primaryColor: null, status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null, lastSyncAt: now,
    lastTransactionsSyncAt: now, lastError: null, syncingUntil: null, removedAt: null, createdAt: now, updatedAt: now,
  } as never);
  await h.ctx.col.accounts.insertOne({
    _id: acc, userId, connectionId: conn, pluggyAccountId: 'a', type: 'CHECKING', name: 'Bradesco', numberMasked: '1', balanceMinor: 123_456, currency: 'BRL',
    creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: now, updatedAt: now,
  } as never);
  await h.ctx.col.transactions.insertOne({
    userId, accountId: acc, connectionId: conn, pluggyTransactionId: 't', date: now, description: 'PIX ENVIADO FACULDADE NORTE', descriptionNorm: 'pix enviado faculdade norte',
    matchKey: 'faculdade norte', merchant: null, amountMinor: -45_000, currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null,
    pluggyBillId: null, categoryKey: 'educacao', installment: null, categoryId: null, categorySource: 'MANUAL', categoryConfidence: null, invoiceId: null, tags: [],
    notes: null, hidden: false, deletedAt: null, createdAt: now, updatedAt: now,
  } as never);
  return userId;
}

const ask = async (userId: ObjectId, question: string) =>
  h.app.inject({ method: 'POST', url: '/v1/assistant/ask', payload: { question }, headers: { authorization: `Bearer ${await h.token(userId)}` } });

describe('assistente', () => {
  it('sem chave de LLM responde 503 (o app cai nas respostas por regras)', async () => {
    const res = await ask(await seed(), 'Quanto gastei?');
    expect(res.statusCode).toBe(503);
  });

  it('manda ao LLM os numeros calculados pela API e devolve o texto', async () => {
    const calls: { system: string; prompt: string }[] = [];
    h.ctx.llm = { generate: async (i) => (calls.push(i), 'Você gastou R$ 450,00 com educação.') };
    const res = await ask(await seed(), 'Quanto paguei de faculdade?');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ answer: 'Você gastou R$ 450,00 com educação.' });
    const prompt = calls[0]!.prompt.replace(/\u00a0/g, ' ');
    expect(prompt).toContain('Total: R$ 1.234,56');
    expect(prompt).toContain('Educação: R$ 450,00');
    expect(prompt).toContain('"faculdade norte"');
    expect(prompt).toContain('PERGUNTA: Quanto paguei de faculdade?');
  });

  it('falha do provedor vira 502 sem vazar detalhes', async () => {
    h.ctx.llm = { generate: async () => Promise.reject(new Error('quota')) };
    const res = await ask(await seed(), 'Oi');
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('LLM_FAILED');
    expect(res.body).not.toContain('quota');
  });
});
