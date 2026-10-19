import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '../../integrations/email/resend';
import type { PushMessage } from '../../integrations/push/webpush';
import { startHarness, type Harness } from '../../test/harness';
import { isoWeek, runAlerts, tickAlerts } from './service';

// Fase 5: alertas (RN-A01..A05).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

// 2026-10-16 (sexta) 09:00 em Manaus = 13:00 UTC.
const NOW = new Date('2026-10-16T13:00:00Z');
let userId: ObjectId;
let pushes: PushMessage[];
let emails: OutgoingEmail[];
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

beforeEach(async () => {
  await h.reset();
  pushes = [];
  emails = [];
  h.ctx.pusher = { publicKey: 'BPub', send: async (_s, m) => (pushes.push(m), 'ok') };
  h.ctx.mailer = { send: async (e) => (emails.push(e), { id: 'm' }) };
  h.ctx.llm = null;
  userId = (await h.createUser()).id;
  await h.ctx.col.accounts.insertOne({
    userId, connectionId: new ObjectId(), pluggyAccountId: 'c', type: 'CHECKING', name: 'Conta', numberMasked: null, balanceMinor: 10_000, currency: 'BRL',
    creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: NOW, updatedAt: NOW,
  } as never);
  await h.ctx.col.pushSubscriptions.insertOne({ userId, endpoint: ENDPOINT, keysEnc: h.ctx.crypto.encrypt(JSON.stringify({ p256dh: 'k'.repeat(30), auth: 'a'.repeat(10) })), userAgent: null, createdAt: NOW, lastSuccessAt: null } as never);
});

const req = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });

const bill = (payee: string, amountMinor: number, dueDate: string) =>
  h.ctx.col.bills.insertOne({
    userId, payeeEnc: h.ctx.crypto.encrypt(payee), amountEnc: h.ctx.crypto.encrypt(String(amountMinor)), dueDate, status: 'pending', lineEnc: null, fine: 0.02,
    monthlyInterest: 0.01, paidAt: null, paidTransactionId: null, createdAt: NOW, updatedAt: NOW,
  } as never);

describe('boleto que o saldo nao cobre', () => {
  it('avisa no painel com os numeros, e no push/e-mail sem valor nem nome (RN-A03)', async () => {
    await bill('Escola Aurora', 50_000, '2026-10-18');
    const r = await runAlerts(h.ctx, userId, 'daily', NOW);
    expect(r).toEqual({ created: 1, sent: 1 });

    const [a] = (await req('GET', '/v1/alerts')).json();
    expect(a).toMatchObject({ type: 'bill_due', title: 'Escola Aurora vence no domingo', action: { page: 'bills' } });
    expect(a.body).toContain('faltam R$');
    expect(a.why.join(' ')).toContain('Saldo em conta');

    expect(pushes).toEqual([{ body: 'Uma conta vence em 2 dias e o saldo pode não cobrir. Toque para ver.', url: '/contas', urgent: false }]);
    expect(emails[0]!.subject).toBe('Pluto: você tem um aviso');
    for (const text of [pushes[0]!.body, emails[0]!.subject, emails[0]!.text]) {
      expect(text).not.toMatch(/R\$|Escola|Aurora|500/);
    }
  });

  it('nao repete o mesmo alerta em 72 h (RN-A02) e manda no maximo 3 por dia (RN-A01)', async () => {
    for (let i = 0; i < 5; i++) await bill(`Conta ${i}`, 20_000 + i, '2026-10-17');
    expect(await runAlerts(h.ctx, userId, 'daily', NOW)).toEqual({ created: 5, sent: 3 });
    expect(await runAlerts(h.ctx, userId, 'daily', new Date(NOW.getTime() + 3_600_000))).toEqual({ created: 0, sent: 0 });
    expect(pushes).toHaveLength(3);
    // Todos ficam no painel.
    expect((await req('GET', '/v1/alerts')).json()).toHaveLength(5);
  });

  it('no silencio (22h-7h) so vencimento do dia vai para o push', async () => {
    await bill('Luz', 30_000, '2026-10-17');
    const night = new Date('2026-10-17T03:30:00Z'); // 23:30 em Manaus, dia 16
    expect(await runAlerts(h.ctx, userId, 'daily', night)).toEqual({ created: 1, sent: 0 });
    await bill('Agua', 30_000, '2026-10-17');
    const lateNight = new Date('2026-10-17T05:00:00Z'); // 01:00 do dia 17: vence hoje
    expect(await runAlerts(h.ctx, userId, 'daily', lateNight)).toMatchObject({ sent: 1 });
    expect(pushes.at(-1)).toMatchObject({ body: 'Uma conta vence hoje e o saldo pode não cobrir. Toque para ver.', urgent: true });
  });

  it('respeita a preferencia de canais e registra "util / nao util" (RN-A04)', async () => {
    expect((await req('PATCH', '/v1/alerts/settings', { email: false })).json()).toMatchObject({ push: true, email: false, pushAvailable: true, devices: 1 });
    await bill('Gás', 30_000, '2026-10-17');
    await runAlerts(h.ctx, userId, 'daily', NOW);
    expect(emails).toHaveLength(0);
    expect(pushes).toHaveLength(1);
    const [a] = (await req('GET', '/v1/alerts')).json();
    expect((await req('PATCH', `/v1/alerts/${a.id}`, { feedback: 'not_useful' })).json()).toMatchObject({ feedback: 'not_useful' });
  });
});

describe('inscricao de push', () => {
  it('aceita so servico de push conhecido (evita SSRF)', async () => {
    const keys = { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) };
    expect((await req('POST', '/v1/push/subscribe', { endpoint: 'https://127.0.0.1/x', keys })).statusCode).toBe(400);
    expect((await req('POST', '/v1/push/subscribe', { endpoint: 'https://user@fcm.googleapis.com/x', keys })).statusCode).toBe(400);
    expect((await req('POST', '/v1/push/subscribe', { endpoint: 'https://fcm.googleapis.com.evil.com/x', keys })).statusCode).toBe(400);
    const ok = await req('POST', '/v1/push/subscribe', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz', keys });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().devices).toBe(2);
    const raw = await h.ctx.col.pushSubscriptions.findOne({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz' });
    expect(raw!.keysEnc).toMatch(/^v1\./);
  });

  it('remove inscricao expirada (410) ao enviar', async () => {
    h.ctx.pusher = { publicKey: 'BPub', send: async () => 'gone' };
    expect((await req('POST', '/v1/alerts/test')).json()).toEqual({ channels: ['email'] });
    expect(await h.ctx.col.pushSubscriptions.countDocuments({ userId })).toBe(0);
  });
});

describe('resumo semanal e agenda', () => {
  it('Gemini so com agregados; texto com valor em reais cai no texto local (RN-I02, RN-I03)', async () => {
    const tx = (daysAgo: number, amountMinor: number, categoryKey: string) => ({
      userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `w${daysAgo}${categoryKey}`, date: new Date(NOW.getTime() - daysAgo * 86_400_000),
      description: 'IFOOD *LOJA 123', descriptionNorm: 'ifood loja', matchKey: 'ifood loja', merchant: 'iFood', amountMinor, currency: 'BRL', type: 'EXPENSE', status: 'POSTED',
      pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey, installment: null, categoryId: null, categorySource: null, categoryConfidence: null,
      invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: true, counterpartyKey: null, createdAt: NOW, updatedAt: NOW,
    });
    await h.ctx.col.transactions.insertMany([...Array.from({ length: 56 }, (_, i) => tx(i + 8, -1000, 'delivery')), ...Array.from({ length: 7 }, (_, i) => tx(i + 1, -3000, 'delivery'))] as never);
    const prompts: string[] = [];
    h.ctx.llm = { generate: async (i) => (prompts.push(i.prompt), JSON.stringify({ fortes: ['Gastou só R$ 10'], atencao: [], prioridade: 'x' })) };
    await runAlerts(h.ctx, userId, 'weekly', NOW);
    expect(prompts[0]).not.toMatch(/ifood|iFood|R\$|IFOOD|-?\d{4,}/);
    const [a] = (await req('GET', '/v1/alerts')).json();
    expect(a.type).toBe('weekly_summary');
    expect(a.body).toContain('Delivery: 200% acima da sua média semanal.');
    expect(a.body).not.toContain('R$');
  });

  it('agenda idempotente: diario uma vez por dia, semanal uma vez por semana', async () => {
    await bill('Internet', 30_000, '2026-10-17');
    await tickAlerts(h.ctx, NOW);
    await tickAlerts(h.ctx, new Date(NOW.getTime() + 600_000));
    expect(await h.ctx.col.alerts.countDocuments({ userId })).toBe(1);
    expect(await h.ctx.col.jobRuns.countDocuments({ _id: { $regex: `^${userId.toHexString()}:daily:` } })).toBe(1);
    expect(isoWeek('2026-10-16')).toBe('2026-W42');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});
