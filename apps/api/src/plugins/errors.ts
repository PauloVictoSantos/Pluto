import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';

// Erros no formato { error: { code, message } } (secao 7).
// Detalhes ficam so no log do servidor (secao 6.3).
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Requisicao invalida' } });
    }

    // AppError: erro de negocio com mensagem escrita para o usuario (inclusive 502/503).
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.warn({ code: err.code }, err.message);
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }

    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'erro interno');

    reply.status(status).send({
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : (err.code ?? 'REQUEST_ERROR'),
        message: status >= 500 ? 'Erro interno' : err.message,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota nao encontrada' } });
  });
}
