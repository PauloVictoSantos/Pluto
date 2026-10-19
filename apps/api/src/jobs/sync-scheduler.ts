import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context';
import { processCharges } from '../modules/charges/service';
import { syncConnection } from '../modules/sync/service';

/**
 * Sincronizacao periodica (secao 3.7): a cada SYNC_INTERVAL_HOURS, e uma vez logo apos iniciar
 * (se a maquina ficou desligada, sincroniza ao voltar). Conexoes que exigem acao do usuario
 * ficam de fora ate ele reconectar (RN-03).
 * Execucao em processo; trocar por Agenda/BullMQ se a API passar a ter mais de uma instancia.
 */
export function startSyncScheduler(ctx: AppContext, log: FastifyBaseLogger) {
  const pluggy = ctx.pluggy;
  if (!pluggy) {
    log.warn('Pluggy não configurado: sincronização periódica desativada');
    return () => {};
  }
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const conns = await ctx.col.connections.find({ active: true, needsAction: false, removedAt: null }, { projection: { _id: 1 } }).toArray();
      for (const { _id } of conns) {
        const r = await syncConnection({ col: ctx.col, pluggy, crypto: ctx.crypto, log }, _id).catch((err) => {
          log.error({ err, connectionId: String(_id) }, 'falha na sincronização');
          return null;
        });
        if (r) log.info({ connectionId: String(_id), status: r.status, transactions: r.transactions }, 'sincronização concluída');
      }
    } finally {
      running = false;
    }
  };

  const first = setTimeout(run, 15_000);
  const every = setInterval(run, ctx.env.SYNC_INTERVAL_HOURS * 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/**
 * Cobrancas por boleto: emite parcelas que entraram na janela de 60 dias do Stripe e atualiza as
 * abertas (rede de seguranca para quando o webhook nao chega, como no computador local).
 */
export function startChargeScheduler(ctx: AppContext, log: FastifyBaseLogger) {
  if (!ctx.stripe) return () => {};
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    await processCharges(ctx, {}, log).catch((err) => log.error({ err }, 'falha no job de cobranças'));
    running = false;
  };
  const first = setTimeout(run, 30_000);
  const every = setInterval(run, ctx.env.SYNC_INTERVAL_HOURS * 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
