import type { Env } from './config/env';
import type { Collections } from './db/collections';
import type { Llm } from './integrations/llm/gemini';
import type { PluggyGateway } from './integrations/pluggy/gateway';
import type { FieldCrypto } from './lib/crypto';
import { AppError } from './lib/errors';
import type { Jwt } from './lib/jwt';

/** Dependencias da aplicacao, injetadas em buildApp (facilita testes). */
export interface AppContext {
  env: Env;
  col: Collections;
  crypto: FieldCrypto;
  jwt: Jwt | null;
  /** null quando PLUGGY_CLIENT_ID/SECRET nao estao configurados. */
  pluggy: PluggyGateway | null;
  pingDb: () => Promise<boolean>;
  /** null/ausente quando nao ha chave de LLM: o app usa as respostas por regras. */
  llm?: Llm | null;
}

export function pluggyOf(ctx: AppContext): PluggyGateway {
  if (!ctx.pluggy) throw new AppError(503, 'PLUGGY_NOT_CONFIGURED', 'Integração com o Pluggy não configurada');
  return ctx.pluggy;
}
