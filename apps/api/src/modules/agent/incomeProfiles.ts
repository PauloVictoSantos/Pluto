import { MAX_INCOME_PROFILES, type CreateIncomeProfile, type IncomeProfile, type IncomeProfiles, type UpdateIncomeProfile } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { IncomeProfileDoc } from '../../db/collections';
import { AppError, notFound } from '../../lib/errors';

// Perfis financeiros (doc. Melhorias, passo 6): ate 2 fontes de renda por usuario, validado aqui
// (o app tambem bloqueia). A renda que o Plutao usa e a soma dos perfis (profile.ts).

const toDto = (ctx: AppContext, d: IncomeProfileDoc): IncomeProfile => ({
  id: d._id.toHexString(),
  name: d.name,
  cover: d.cover,
  netIncomeMinor: Number(ctx.crypto.decrypt(d.netIncomeEnc)),
  payDay: d.payDay,
  incomeType: d.incomeType,
  notes: d.notes,
  createdAt: d.createdAt.toISOString(),
});

export async function listIncomeProfiles(ctx: AppContext, userId: ObjectId): Promise<IncomeProfiles> {
  const items = (await ctx.col.incomeProfiles.find({ userId }).sort({ createdAt: 1 }).toArray()).map((d) => toDto(ctx, d));
  return { items, totalIncomeMinor: items.reduce((t, i) => t + i.netIncomeMinor, 0), max: MAX_INCOME_PROFILES };
}

/** Soma das rendas dos perfis; null quando o usuario nao tem perfil (vale a renda do perfil unico). */
export async function profilesIncome(ctx: AppContext, userId: ObjectId): Promise<number | null> {
  const docs = await ctx.col.incomeProfiles.find({ userId }, { projection: { netIncomeEnc: 1 } }).toArray();
  return docs.length ? docs.reduce((t, d) => t + Number(ctx.crypto.decrypt(d.netIncomeEnc)), 0) : null;
}

const limitReached = () => new AppError(409, 'PROFILE_LIMIT', `Limite de ${MAX_INCOME_PROFILES} perfis. Edite ou exclua um perfil para criar outro.`);

export async function createIncomeProfile(ctx: AppContext, userId: ObjectId, b: CreateIncomeProfile) {
  if ((await ctx.col.incomeProfiles.countDocuments({ userId })) >= MAX_INCOME_PROFILES) throw limitReached();
  const now = new Date();
  const doc: IncomeProfileDoc = {
    _id: new ObjectId(),
    userId,
    name: b.name,
    cover: b.cover,
    netIncomeEnc: ctx.crypto.encrypt(String(b.netIncomeMinor)),
    payDay: b.payDay,
    incomeType: b.incomeType,
    notes: b.notes || null,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.col.incomeProfiles.insertOne(doc);
  // Dois pedidos ao mesmo tempo: o que passou do limite e desfeito.
  const ids = (await ctx.col.incomeProfiles.find({ userId }, { projection: { _id: 1 } }).sort({ createdAt: 1, _id: 1 }).toArray()).map((d) => d._id);
  if (ids.slice(MAX_INCOME_PROFILES).some((id) => id.equals(doc._id))) {
    await ctx.col.incomeProfiles.deleteOne({ _id: doc._id });
    throw limitReached();
  }
  return listIncomeProfiles(ctx, userId);
}

async function own(ctx: AppContext, userId: ObjectId, id: string) {
  const d = ObjectId.isValid(id) ? await ctx.col.incomeProfiles.findOne({ _id: new ObjectId(id), userId }) : null;
  if (!d) throw notFound('Perfil');
  return d;
}

export async function updateIncomeProfile(ctx: AppContext, userId: ObjectId, id: string, b: UpdateIncomeProfile) {
  const d = await own(ctx, userId, id);
  const set: Partial<IncomeProfileDoc> = { updatedAt: new Date() };
  if (b.name !== undefined) set.name = b.name;
  if (b.cover !== undefined) set.cover = b.cover;
  if (b.netIncomeMinor !== undefined) set.netIncomeEnc = ctx.crypto.encrypt(String(b.netIncomeMinor));
  if (b.payDay !== undefined) set.payDay = b.payDay;
  if (b.incomeType !== undefined) set.incomeType = b.incomeType;
  if (b.notes !== undefined) set.notes = b.notes || null;
  await ctx.col.incomeProfiles.updateOne({ _id: d._id }, { $set: set });
  return listIncomeProfiles(ctx, userId);
}

export async function removeIncomeProfile(ctx: AppContext, userId: ObjectId, id: string) {
  const d = await own(ctx, userId, id);
  await ctx.col.incomeProfiles.deleteOne({ _id: d._id });
  return listIncomeProfiles(ctx, userId);
}
