/** Erro de negocio com status HTTP e codigo estavel; a mensagem vai ao cliente (secao 7). */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new AppError(404, 'NOT_FOUND', `${what} não encontrado`);
