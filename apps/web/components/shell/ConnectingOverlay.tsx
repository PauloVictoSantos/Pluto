'use client';

import { useApp } from '@/lib/store';

/** Servidor acordando ou conexao instavel: aviso calmo no lugar de erro (doc. Melhorias, passo 2). */
export function ConnectingOverlay() {
  const connecting = useApp((s) => s.connecting);
  if (!connecting) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[100] grid place-items-center bg-background/85 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="size-8 animate-spin rounded-full border-[3px] border-muted border-t-brand" aria-hidden />
        <div className="text-base font-semibold">Preparando o Pluto…</div>
        <div className="max-w-[260px] text-sm text-muted-foreground">Estamos conectando com o servidor. Isso leva alguns segundos.</div>
      </div>
    </div>
  );
}
