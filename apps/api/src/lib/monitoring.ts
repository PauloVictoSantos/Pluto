import * as Sentry from '@sentry/node';

// Erros inesperados (5xx, falhas de jobs) vao para o Sentry quando SENTRY_DSN existe.
// Nada de dados pessoais: sem cabecalhos, cookies, corpo nem usuario no evento.
let enabled = false;

export function initMonitoring(dsn: string | undefined, environment: string) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    // Variaveis locais da pilha poderiam conter valores, CPF ou tokens.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, databaseQueryData: false, stackFrameVariables: false },
    enhanceFetchErrorMessages: 'report-only',
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) event.request = { method: event.request.method, url: event.request.url?.split('?')[0] };
      delete event.user;
      return event;
    },
  });
  enabled = true;
  return true;
}

export function reportError(err: unknown, tags: Record<string, string> = {}) {
  if (enabled) Sentry.captureException(err, { tags });
}
