import type { Collection, Document, ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';

// LGPD (doc. Pluton 8.5): acesso (exportacao completa) e exclusao real, incluindo a conversa com o
// Plutao. Campos criptografados saem abertos para o proprio titular; segredos de acesso nunca saem.

/** Segredos e controles internos: nao fazem parte dos dados pessoais exportados. */
const SECRET = new Set(['passwordHash', 'totp', 'recoveryCodesHash', 'refreshTokenHash', 'cpfHash', 'pluggyItemIdHash', 'pluggyItemIdEnc', 'keysEnc', 'secretEnc', 'publicKey', 'credentialId', 'counter', 'features', 'score']);
/** Colecoes de sistema que nao sao dados do titular. */
const SKIP = new Set(['users', 'sessions', 'webauthnChallenges', 'jobRuns']);

function open(ctx: AppContext, doc: Document): Document {
  const out: Document = {};
  for (const [k, v] of Object.entries(doc)) {
    if (SECRET.has(k) || k === 'userId') continue;
    if (k === 'stateEnc' && typeof v === 'string') {
      // Conversa com o Plutao: so o que foi dito (sem o contexto interno do modelo).
      out.conversa = (JSON.parse(ctx.crypto.decrypt(v)) as { transcript: unknown[] }).transcript;
    } else if (k.endsWith('Enc') && typeof v === 'string') {
      try {
        out[k.slice(0, -3)] = ctx.crypto.decrypt(v);
      } catch {
        out[k.slice(0, -3)] = null;
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && v.constructor?.name === 'Object') out[k] = open(ctx, v as Document);
    else out[k] = v;
  }
  return out;
}

const collectionsOf = (ctx: AppContext) => Object.entries(ctx.col) as [string, Collection<Document>][];

export async function exportData(ctx: AppContext, userId: ObjectId) {
  const u = await ctx.col.users.findOne({ _id: userId });
  const data: Record<string, unknown> = {
    geradoEm: new Date().toISOString(),
    titular: u && { nome: u.name, email: u.email, telefone: u.phone ?? null, cpf: u.cpfEnc ? ctx.crypto.decrypt(u.cpfEnc) : null, criadoEm: u.createdAt, configuracoes: u.settings },
  };
  for (const [name, col] of collectionsOf(ctx)) {
    if (SKIP.has(name)) continue;
    const docs = await col.find({ userId }).toArray();
    if (docs.length) data[name] = docs.map((d) => open(ctx, d));
  }
  data.passkeys = (await ctx.col.passkeys.find({ userId }).toArray()).map((p) => ({ nome: (p as Document).name ?? null, criadaEm: p.createdAt }));
  return data;
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Transacoes em CSV (separador ";" e virgula decimal, como o Excel em pt-BR abre). */
export async function exportTransactionsCsv(ctx: AppContext, userId: ObjectId) {
  const accounts = new Map((await ctx.col.accounts.find({ userId }).toArray()).map((a) => [String(a._id), a.name]));
  const rows = await ctx.col.transactions.find({ userId, deletedAt: null }).sort({ date: 1 }).toArray();
  const head = ['data', 'descricao', 'valor', 'tipo', 'categoria', 'conta', 'status', 'observacoes'];
  const lines = rows.map((t) =>
    [t.date, t.description, (t.amountMinor / 100).toFixed(2).replace('.', ','), t.type, t.categoryKey, accounts.get(String(t.accountId)) ?? '', t.status, t.notes ?? ''].map(csvCell).join(';'),
  );
  // BOM: o Excel abre os acentos certos.
  return `${String.fromCharCode(0xfeff)}${[head.join(';'), ...lines].join('\r\n')}\r\n`;
}

/**
 * Exclusao real: tudo do titular sai do banco agora (o doc pede ate 15 dias), inclusive auditoria e
 * conversa com o Plutao. Conexoes do widget sao removidas no Pluggy (no Meu Pluggy o titular revoga
 * em meu.pluggy.ai). Fica so um registro anonimo de que uma conta foi excluida.
 */
export async function deleteAccount(ctx: AppContext, userId: ObjectId) {
  let pluggyFailures = 0;
  if (ctx.pluggy)
    for (const c of await ctx.col.connections.find({ userId, source: 'WIDGET', removedAt: null }).toArray()) {
      try {
        await ctx.pluggy.deleteItem(ctx.crypto.decrypt(c.pluggyItemIdEnc));
      } catch (e) {
        if ((e as { response?: { statusCode?: number } }).response?.statusCode !== 404) pluggyFailures++;
      }
    }
  const removed: Record<string, number> = {};
  for (const [name, col] of collectionsOf(ctx)) {
    if (name === 'users') continue;
    const r = await col.deleteMany({ userId });
    if (r.deletedCount) removed[name] = r.deletedCount;
  }
  await ctx.col.jobRuns.deleteMany({ _id: { $regex: `^${userId.toHexString()}:` } });
  await ctx.col.agentUsage.deleteMany({ _id: { $regex: `^${userId.toHexString()}:` } });
  await ctx.col.users.deleteOne({ _id: userId });
  await audit(ctx.col, 'user.deleted', null, { collections: Object.keys(removed).length, pluggyFailures });
  return { removed, pluggyFailures };
}

/** Consentimento explicito para a IA do Plutao (base legal, 8.5). Revogar apaga a conversa. */
export async function setAiConsent(ctx: AppContext, userId: ObjectId, accept: boolean, ip: string | null) {
  await ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiConsentAt': accept ? new Date().toISOString() : null, updatedAt: new Date() } });
  if (!accept) await ctx.col.agentSessions.deleteMany({ userId });
  await audit(ctx.col, accept ? 'ai.consent_given' : 'ai.consent_revoked', userId, {}, ip);
}
