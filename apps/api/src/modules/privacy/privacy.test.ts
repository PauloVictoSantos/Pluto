import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

// LGPD (doc. Pluton 8.5): exportacao completa (JSON/CSV), exclusao real incluindo conversa com o
// Plutao, consentimento explicito para IA e contestacao registrada.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
const req = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, authAgeSec = 0, who = userId) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(who, { authAgeSec })}` } });

async function seed() {
  const now = new Date(), acc = new ObjectId(), conn = new ObjectId();
  await req('PUT', '/v1/agent/profile', { netIncomeMinor: 432_100 });
  await req('POST', '/v1/agent/loans', { creditor: 'Banco Y', kind: 'emprestimo', balanceMinor: 765_400, monthlyRate: 0.03, installmentMinor: 50_000, installmentsLeft: 20, dueDay: 5 });
  await h.ctx.col.connections.insertOne({
    _id: conn, userId, pluggyItemIdEnc: h.ctx.crypto.encrypt('item-widget-1'), pluggyItemIdHash: 'h1', source: 'WIDGET', connectorId: 1, institutionName: 'Banco X', imageUrl: null,
    primaryColor: null, status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null, lastSyncAt: now, lastTransactionsSyncAt: now, lastError: null, syncingUntil: null,
    removedAt: null, createdAt: now, updatedAt: now,
  } as never);
  await h.ctx.col.accounts.insertOne({
    _id: acc, userId, connectionId: conn, pluggyAccountId: 'a', type: 'CHECKING', name: 'Conta "Principal"', numberMasked: '1', balanceMinor: 1, currency: 'BRL', creditLimitMinor: null,
    availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: now, updatedAt: now,
  } as never);
  await h.ctx.col.transactions.insertOne({
    userId, accountId: acc, connectionId: conn, pluggyTransactionId: 't1', date: new Date('2026-10-01T15:00:00Z'), description: 'MERCADO; BOM', descriptionNorm: 'mercado bom',
    matchKey: 'mercado bom', merchant: null, amountMinor: -12_345, currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null,
    categoryKey: 'mercado', installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null,
    hasTime: true, counterpartyKey: null, createdAt: now, updatedAt: now,
  } as never);
  await req('POST', '/v1/agent/consent', { accept: true });
  h.ctx.llm = { generate: async () => '', chat: async () => [{ text: 'Oi! Em que posso ajudar no seu plano?' }] };
  await req('POST', '/v1/agent/chat', { message: 'oi, tudo bem?' });
}

beforeEach(async () => {
  await h.reset();
  h.pluggy.calls = [];
  userId = (await h.createUser({ email: 'titular@pluto.test' })).id;
});

describe('LGPD', () => {
  it('exportacao exige autenticacao recente e sai completa, aberta e sem segredos', async () => {
    await seed();
    expect((await req('GET', '/v1/me/export', undefined, 3600)).json().error.code).toBe('REAUTH_REQUIRED');
    const f = (await req('GET', '/v1/me/export')).json();
    expect(f.filename).toMatch(/^pluto-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
    const d = JSON.parse(f.content);
    expect(d.titular).toMatchObject({ email: 'titular@pluto.test' });
    expect(d.financialProfiles[0].netIncome).toBe('432100');
    expect(d.loans[0].balance).toBe('765400');
    expect(d.agentSessions[0].conversa.map((m: { text: string }) => m.text)).toEqual(['oi, tudo bem?', 'Oi! Em que posso ajudar no seu plano?']);
    expect(d.transactions).toHaveLength(1);
    for (const secret of ['passwordHash', 'secretEnc', 'refreshTokenHash', 'pluggyItemId', 'item-widget-1', 'cpfHash']) expect(f.content).not.toContain(secret);
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'user.exported' })).not.toBeNull();
  });

  it('CSV das transacoes: BOM, ponto e virgula e virgula decimal', async () => {
    await seed();
    const f = (await req('GET', '/v1/me/export?format=csv')).json();
    expect(f.mime).toBe('text/csv;charset=utf-8');
    const lines = f.content.split('\r\n');
    expect(lines[0].charCodeAt(0)).toBe(0xfeff);
    expect(lines[0].slice(1)).toBe('data;descricao;valor;tipo;categoria;conta;status;observacoes');
    expect(lines[1]).toBe('2026-10-01T15:00:00.000Z;"MERCADO; BOM";-123,45;EXPENSE;mercado;"Conta ""Principal""";POSTED;');
  });

  it('exclusao real: tudo do titular sai (inclusive chat e auditoria), o resto fica', async () => {
    await seed();
    const other = (await h.createUser({ email: 'vizinho@pluto.test' })).id;
    await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 1 }, headers: { authorization: `Bearer ${await h.token(other)}` } });
    expect((await req('DELETE', '/v1/me', { confirm: 'EXCLUIR' }, 3600)).statusCode).toBe(401);
    expect((await req('DELETE', '/v1/me', { confirm: 'sim' })).statusCode).toBe(400);
    expect((await req('DELETE', '/v1/me', { confirm: 'EXCLUIR' })).statusCode).toBe(204);

    expect(h.pluggy.calls).toContain('delete:item-widget-1');
    expect(await h.ctx.col.users.findOne({ _id: userId })).toBeNull();
    for (const [name, col] of Object.entries(h.ctx.col)) expect(await (col as typeof h.ctx.col.users).countDocuments({ userId } as never), name).toBe(0);
    expect(await h.ctx.col.agentUsage.countDocuments({ _id: { $regex: `^${userId.toHexString()}` } })).toBe(0);
    const tomb = await h.ctx.col.auditLogs.findOne({ event: 'user.deleted' });
    expect(tomb).toMatchObject({ userId: null });
    expect(JSON.stringify(tomb)).not.toContain('titular@pluto.test');
    expect(await h.ctx.col.financialProfiles.countDocuments({ userId: other })).toBe(1);
  });

  it('consentimento de IA: sem ele o Plutao nao conversa; revogar apaga a conversa', async () => {
    h.ctx.llm = { generate: async () => '', chat: async () => [{ text: 'Oi!' }] };
    let r = await req('POST', '/v1/agent/chat', { message: 'oi' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('AI_CONSENT_REQUIRED');
    expect((await req('GET', '/v1/agent/chat')).json()).toMatchObject({ consent: false });
    await req('POST', '/v1/agent/consent', { accept: true });
    expect((await req('GET', '/v1/me')).json().settings.aiConsentAt).toEqual(expect.any(String));
    r = await req('POST', '/v1/agent/chat', { message: 'oi' });
    expect(r.json()).toMatchObject({ consent: true });
    await req('POST', '/v1/agent/consent', { accept: false });
    expect(await h.ctx.col.agentSessions.countDocuments({ userId })).toBe(0);
    expect((await h.ctx.col.auditLogs.find({ userId, event: /^ai\.consent/ }).toArray()).map((a) => a.event)).toEqual(['ai.consent_given', 'ai.consent_revoked']);
  });

  it('contestacao de veredito fica registrada e visivel ao titular', async () => {
    const r = await req('POST', '/v1/agent/contestations', { subject: 'Veredito da compra: TV', text: 'O limite não considerou meu bônus.' });
    expect(r.json()).toEqual([expect.objectContaining({ subject: 'Veredito da compra: TV', text: 'O limite não considerou meu bônus.' })]);
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'agent.contested' })).not.toBeNull();
    expect((await req('POST', '/v1/agent/contestations', { subject: 'x', text: '' })).statusCode).toBe(400);
  });
});
