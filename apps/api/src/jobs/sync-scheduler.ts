import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context';
import { processCharges } from '../modules/charges/service';
import { tickAlerts } from '../modules/alerts/service';
import { markOverdueBills } from '../modules/bills/routes';
import { syncDebtBills } from '../modules/debts/service';
import { rollShoppingLists } from '../modules/shopping/service';
import { ensureMonthLimits } from '../modules/agent/limit';
import { reportError } from '../lib/monitoring';
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
        const r = await syncConnection({ col: ctx.col, pluggy, crypto: ctx.crypto, llm: ctx.llm, log }, _id).catch((err) => {
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
    await processCharges(ctx, {}, log).catch((err) => (log.error({ err }, 'falha no job de cobranças'), reportError(err, { job: 'cobrancas' })));
    running = false;
  };
  const first = setTimeout(run, 30_000);
  const every = setInterval(run, ctx.env.SYNC_INTERVAL_HOURS * 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/**
 * Boletos a pagar: pendente com vencimento passado vira vencido (RN-M03).
 * Lista de compras: no dia 1 (00:05 no fuso do usuario) fecha a do mes anterior e abre a nova com as
 * sugestoes. Verifica a cada 5 min; idempotente (indice unico por mes). A tela tambem abre/fecha ao
 * ser aberta, entao o job so garante a virada mesmo sem ninguem abrir o app.
 */
export function startPlannerScheduler(ctx: AppContext, log: FastifyBaseLogger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const n = await rollShoppingLists(ctx);
      if (n) log.info({ lists: n }, 'listas de compras do mês abertas');
      // Boleto do mes das dividas manuais (vira o mes sozinho).
      for (const userId of await ctx.col.debtSources.distinct('userId')) await syncDebtBills(ctx, userId);
      // LG-03: limite do mes novo calculado na virada.
      const limits = await ensureMonthLimits(ctx);
      if (limits) log.info({ limits }, 'limites do mês calculados');
      const overdue = await markOverdueBills(ctx);
      if (overdue) log.info({ bills: overdue }, 'boletos marcados como vencidos');
    } catch (err) {
      log.error({ err }, 'falha no job de planejamento');
      reportError(err, { job: 'planejamento' });
    } finally {
      running = false;
    }
  };
  const every = setInterval(run, 5 * 60_000);
  return () => clearInterval(every);
}

/**
 * Alertas (doc. "Rotas de API e jobs"): diario as 07:00, semanal domingo 19:00 e o lembrete antes do
 * pico de gastos, no fuso de cada usuario. Verifica a cada 10 min; jobRuns garante uma execucao por periodo.
 */
export function startAlertsScheduler(ctx: AppContext, log: FastifyBaseLogger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tickAlerts(ctx);
    } catch (err) {
      log.error({ err }, 'falha no job de alertas');
      reportError(err, { job: 'alertas' });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 60_000);
  const every = setInterval(run, 10 * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
