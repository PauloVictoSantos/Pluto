'use client';

import { useCallback, useState } from 'react';

// Rascunhos de formulario fora do componente (doc. Melhorias, passo 6): ocultar/mostrar valores
// remonta a pagina, e o que foi digitado e nao salvo nao pode sumir. Ficam so na memoria da aba.
const drafts = new Map<string, unknown>();

export function useDraft<T>(key: string, initial: () => T): [T, (v: T | ((cur: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? (drafts.get(key) as T) : initial()));
  const set = useCallback(
    (v: T | ((cur: T) => T)) =>
      setValue((cur) => {
        const next = typeof v === 'function' ? (v as (c: T) => T)(cur) : v;
        drafts.set(key, next);
        return next;
      }),
    [key],
  );
  const clear = useCallback(() => void drafts.delete(key), [key]);
  return [value, set, clear];
}

/** Limpa todos os rascunhos (troca de sessao). */
export const clearDrafts = () => drafts.clear();
