'use client';

import type { SavedPayer } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { Icon } from './ui/Icon';

// Contatos do Boleto: quem ja recebeu cobranca fica salvo (dados cifrados no servidor). Um toque
// preenche o formulario inteiro. No topo, o icone e o nome de quem vai pagar.

export function PayerPicker({ name, email, taxId, onPick, onNew }: { name: string; email: string; taxId: string; onPick: (p: SavedPayer) => void; onNew: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['charges', 'payers'], queryFn: api.payers });
  const remove = useMutation({ mutationFn: api.removePayer, onSuccess: (list) => qc.setQueryData(['charges', 'payers'], list) });
  const list = q.data ?? [];
  const digits = taxId.replace(/\D/g, '');
  const current = list.find((p) => p.taxId === digits);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-full text-[20px] font-bold" style={{ background: name.trim() ? 'var(--brand)' : 'var(--muted)', color: name.trim() ? '#fff' : 'var(--muted-foreground)' }} aria-hidden>
          {name.trim() ? initials(name) : <Icon icon="user" size={24} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Para quem é o boleto</span>
          <span className="block truncate text-[18px] font-bold tracking-[-0.02em]">{name.trim() || 'Novo pagador'}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">{current ? `Contato salvo · ${email}` : email || 'Escolha um contato ou preencha abaixo'}</span>
        </span>
        {current && (
          <button type="button" onClick={() => window.confirm(`Excluir ${current.name} dos contatos? Os boletos já emitidos não mudam.`) && remove.mutate(current.id)} aria-label={`Excluir ${current.name} dos contatos`} title="Excluir dos contatos" className="icon-btn size-10 shrink-0">
            <Icon icon="trash-2" size={16} />
          </button>
        )}
      </div>
      {list.length > 0 && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="list" aria-label="Contatos salvos">
          <button type="button" role="listitem" onClick={onNew} className="flex w-[68px] shrink-0 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-foreground">
            <span className="grid size-11 place-items-center rounded-full border-2 border-dashed border-border">
              <Icon icon="plus" size={18} />
            </span>
            <span className="text-[11.5px]">Novo</span>
          </button>
          {list.map((p) => {
            const on = p.taxId === digits;
            return (
              <button key={p.id} type="button" role="listitem" onClick={() => onPick(p)} aria-pressed={on} title={p.name} className="flex w-[68px] shrink-0 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-foreground">
                <span className="grid size-11 place-items-center rounded-full text-[14px] font-bold" style={on ? { background: 'var(--brand)', color: '#fff', boxShadow: '0 0 0 3px var(--brand-soft)' } : { background: 'var(--muted)' }}>
                  {initials(p.name)}
                </span>
                <span className="w-full truncate text-center text-[11.5px]" style={{ fontWeight: on ? 600 : 400 }}>
                  {p.name.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
