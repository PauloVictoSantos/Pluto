'use client';

import type { Connection } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { fmtDateTimeIn } from '@/lib/datetime';
import { BankLogo } from './BankLogo';
import { useApp } from '@/lib/store';
import { useReauth } from './Reauth';
import { Icon } from './ui/Icon';
import { Sheet } from './ui/Sheet';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(c: Connection): { label: string; dot: string } {
  if (!c.active) return { label: 'Consentimento vencido', dot: '#A1A1AA' };
  if (c.needsAction) return { label: c.source === 'MEU_PLUGGY' ? 'Reconecte no Meu Pluggy' : 'Reconectar', dot: '#EF4444' };
  if (!c.lastSyncAt) return { label: 'Importando…', dot: '#7D39EB' };
  if (c.lastError) return { label: c.lastError, dot: '#F59E0B' };
  if (c.status === 'UPDATING' || c.status === 'MERGING') return { label: 'Sincronizando', dot: '#7D39EB' };
  if (c.status === 'OUTDATED') return { label: 'Desatualizada', dot: '#A1A1AA' };
  return { label: 'Conectada', dot: '#22C55E' };
}

/** Contas conectadas (Open Finance via Pluggy): lista, sincroniza, remove e importa do Meu Pluggy. */
export function ConnectionsCard() {
  const qc = useQueryClient();
  const tz = useApp((s) => s.user?.settings.timezone) ?? 'America/Manaus';
  const { run, sheet } = useReauth();
  const [itemId, setItemId] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null);

  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: api.connections,
    // Enquanto a primeira importacao roda em segundo plano, atualiza a lista.
    refetchInterval: (q) => (q.state.data?.some((c) => !c.lastSyncAt) ? 3000 : false),
  });
  const refreshAll = () => qc.invalidateQueries();
  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && e.code === 'REAUTH_CANCELLED') return;
    setMsg({ kind: 'error', text: e instanceof ApiRequestError ? e.message : 'Não conseguimos falar com o Pluto agora. Tente de novo em instantes.' });
  };

  const importMut = useMutation({
    mutationFn: (id: string) => run(() => api.importConnection(id)),
    onSuccess: (c) => {
      setItemId('');
      setMsg({ kind: 'ok', text: `${c.institutionName} conectado. Importando suas transações…` });
      void refreshAll();
    },
    onError: fail,
  });
  const syncMut = useMutation({
    mutationFn: api.syncConnection,
    onSuccess: (r) => {
      setMsg(
        r.status === 'SYNCED'
          ? { kind: 'ok', text: `Sincronizado: ${r.transactions} transações verificadas.` }
          : r.status === 'NEEDS_ACTION'
            ? { kind: 'error', text: 'O banco pediu uma nova autorização. Reconecte no Meu Pluggy.' }
            : r.status === 'SKIPPED'
              ? { kind: 'ok', text: 'Já existe uma sincronização em andamento.' }
              : { kind: 'error', text: 'A sincronização não terminou. Tente de novo em alguns minutos.' },
      );
      void refreshAll();
    },
    onError: fail,
  });
  const removeMut = useMutation({
    mutationFn: ({ id, keep }: { id: string; keep: boolean }) => run(() => api.removeConnection(id, keep)),
    onSuccess: () => {
      setRemoving(null);
      setMsg({ kind: 'ok', text: 'Conexão removida do Pluto.' });
      void refreshAll();
    },
    onError: (e) => {
      setRemoving(null);
      fail(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = itemId.trim();
    if (!UUID.test(id)) return setMsg({ kind: 'error', text: 'O Item ID tem o formato 6ffb472d-9da7-49d5-bec4-ac1d6d7e6cd0.' });
    setMsg(null);
    importMut.mutate(id);
  };

  const list = connections.data ?? [];

  return (
    <div data-anim="" className="card flex flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="card-title">Contas conectadas</span>
        <span className="rounded-full border border-border px-[9px] py-[3px] text-xs text-muted-foreground">Open Finance</span>
      </div>

      {connections.isPending && <div className="border-t border-border py-4 text-sm text-muted-foreground">Carregando…</div>}
      {connections.isError && <div className="border-t border-border py-4 text-sm text-danger-text">Não foi possível carregar as conexões.</div>}
      {connections.isSuccess && list.length === 0 && (
        <div className="border-t border-border py-4 text-sm text-muted-foreground">Nenhum banco conectado ainda. Importe sua conexão do Meu Pluggy abaixo.</div>
      )}

      {list.map((c) => {
        const st = statusOf(c);
        return (
          <div key={c.id} className="flex min-h-16 items-center gap-3 border-t border-border py-2">
            <BankLogo name={c.institutionName} color={c.primaryColor} size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{c.institutionName}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-[7px] rounded-full" style={{ background: st.dot }} />
                {st.label}
                {c.lastSyncAt && <span>· {fmtDateTimeIn(c.lastSyncAt, tz)}</span>}
                {c.source === 'MEU_PLUGGY' && <span>· via Meu Pluggy</span>}
              </div>
            </div>
            <button
              onClick={() => syncMut.mutate(c.id)}
              disabled={syncMut.isPending}
              aria-label={`Sincronizar ${c.institutionName}`}
              className="icon-btn"
              style={{ opacity: syncMut.isPending && syncMut.variables === c.id ? 0.5 : 1 }}
            >
              <Icon icon="refresh-cw" size={16} />
            </button>
            <button onClick={() => setRemoving(c)} aria-label={`Remover ${c.institutionName}`} className="icon-btn">
              <Icon icon="x" size={16} />
            </button>
          </div>
        );
      })}

      <form onSubmit={submit} className="mt-2 flex flex-col gap-2.5 border-t border-border pt-4">
        <div className="text-[15px] font-semibold">Importar do Meu Pluggy</div>
        <div className="text-[13px] leading-normal text-muted-foreground">
          No Dashboard do Pluggy, abra sua aplicação, clique em <strong>Ir para Demo</strong> e use <strong>⋮ › Copiar Item ID</strong> no banco.
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder="Item ID (ex.: 6ffb472d-9da7-…)"
            aria-label="Item ID do Meu Pluggy"
            autoComplete="off"
            spellCheck={false}
            className="input min-w-[220px] flex-1 font-mono text-sm"
          />
          <button type="submit" disabled={importMut.isPending} className="btn btn-primary h-12" style={{ opacity: importMut.isPending ? 0.7 : 1 }}>
            <Icon icon="plus" size={16} />
            {importMut.isPending ? 'Importando…' : 'Importar'}
          </button>
        </div>
      </form>

      {msg && (
        <div
          role={msg.kind === 'error' ? 'alert' : 'status'}
          className="mt-3 flex items-start gap-2 rounded-xl px-3.5 py-3 text-[13px]"
          style={{ background: msg.kind === 'error' ? 'var(--danger-soft)' : 'var(--brand-soft)', color: msg.kind === 'error' ? 'var(--danger-text)' : 'var(--brand-text)' }}
        >
          <Icon icon={msg.kind === 'error' ? 'circle-alert' : 'circle-check'} size={16} />
          {msg.text}
        </div>
      )}

      {removing && (
        <Sheet onClose={() => setRemoving(null)} label={`Remover ${removing.institutionName}`} width={440} top="18vh" gap={14}>
          <div className="text-xl font-bold tracking-[-0.02em]">Remover {removing.institutionName}?</div>
          <div className="text-sm leading-normal text-muted-foreground">
            O Pluto para de sincronizar esta conexão.
            {removing.source === 'MEU_PLUGGY' && ' Para revogar o acesso ao banco, remova também em meu.pluggy.ai.'}
          </div>
          <button
            onClick={() => removeMut.mutate({ id: removing.id, keep: true })}
            disabled={removeMut.isPending}
            className="btn btn-outline h-auto min-h-[50px] flex-col items-start gap-0.5 py-2.5 text-left whitespace-normal"
          >
            <span className="text-[15px]">Manter o histórico</span>
            <span className="text-xs font-normal text-muted-foreground">Transações antigas continuam nos relatórios.</span>
          </button>
          <button
            onClick={() => removeMut.mutate({ id: removing.id, keep: false })}
            disabled={removeMut.isPending}
            className="btn h-auto min-h-[50px] flex-col items-start gap-0.5 border-transparent bg-danger-soft py-2.5 text-left whitespace-normal text-danger-text"
          >
            <span className="text-[15px]">Apagar tudo desta conexão</span>
            <span className="text-xs font-normal">Contas, transações e faturas são excluídas do Pluto.</span>
          </button>
          <button onClick={() => setRemoving(null)} className="btn btn-outline h-12">
            Cancelar
          </button>
        </Sheet>
      )}
      {sheet}
    </div>
  );
}
