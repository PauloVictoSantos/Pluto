import type { ObjectId } from 'mongodb';
import type { Collections } from '../db/collections';

// Trilha de auditoria de eventos sensiveis (secao 6.3). Sem dados pessoais nem segredos em meta.
export async function audit(col: Collections, event: string, userId: ObjectId | null, meta: Record<string, unknown> = {}, ip: string | null = null) {
  await col.auditLogs.insertOne({ userId, event, ip, meta, at: new Date() } as never);
}
