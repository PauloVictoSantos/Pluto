'use client';

import { useRef, useState } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { useEnter } from '@/lib/motion';

const FAQ: [string, string][] = [
  ['Como conecto meu banco?', 'Em Configurações > Contas conectadas, toque em Conectar e escolha o banco. A conexão é feita pelo Open Finance: você autoriza no app do banco e pode revogar quando quiser.'],
  ['Como gero um boleto parcelado?', 'Na aba Boleto, informe o valor total, o número de parcelas e o vencimento da primeira. A Pluto gera um boleto por parcela, com vencimentos mensais, e você envia por WhatsApp ou e-mail.'],
  ['A Pluto movimenta meu dinheiro?', 'Só quando você confirma, como num Pix ou pagamento de conta. Para o resto, a Pluto apenas lê seus dados para organizar e responder suas perguntas.'],
  ['Meus dados estão seguros?', 'Sim. Os dados trafegam criptografados e seguem a LGPD. Nenhuma senha de banco fica guardada no app.'],
  ['Por que meu score mudou?', 'O score Serasa é atualizado conforme seus pagamentos, dívidas e consultas ao CPF. Pagar contas em dia é o que mais ajuda.'],
];

export default function AjudaPage() {
  const { openChat } = useShell();
  const [open, setOpen] = useState(1);
  const [q, setQ] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const term = q.trim().toLowerCase();
  const list = FAQ.map((f, i) => ({ f, i })).filter(({ f }) => !term || (f[0] + f[1]).toLowerCase().includes(term));

  return (
    <div ref={root} className="flex max-w-[820px] flex-col gap-4">
      <h1 data-anim="" className="page-title">
        Ajuda
      </h1>

      <button data-anim="" onClick={openChat} className="flex cursor-pointer items-center gap-3.5 rounded-2xl border-0 bg-brand p-[18px] text-left text-white">
        <span className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-white/15">
          <PlutoLogo size={44} />
        </span>
        <span className="flex flex-1 flex-col gap-[3px]">
          <span className="text-[17px] font-bold">Fale com a Pluto</span>
          <span className="text-sm opacity-90">Respostas na hora, 24h por dia.</span>
        </span>
        <Icon icon="chevron-right" size={20} />
      </button>

      <div data-anim="" className="card flex flex-col gap-3">
        <label className="flex h-12 items-center gap-2 rounded-full border border-border px-4 text-muted-foreground">
          <Icon icon="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar dúvida"
            aria-label="Buscar dúvida"
            className="w-full border-0 bg-transparent text-base text-foreground outline-none"
          />
        </label>
        <div className="flex flex-col">
          {list.map(({ f, i }) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border-b border-border">
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  className="flex min-h-[58px] w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-[15px] font-semibold text-foreground"
                >
                  <span className="flex-1">{f[0]}</span>
                  <span className="flex transition-transform duration-[250ms]" style={{ transform: `rotate(${isOpen ? 180 : 0}deg)` }}>
                    <Icon icon="chevron-down" size={18} />
                  </span>
                </button>
                {isOpen && (
                  <div data-anim="" className="pb-4 text-sm leading-[1.55] text-pretty text-muted-foreground">
                    {f[1]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {list.length === 0 && <div className="py-3 text-sm text-muted-foreground">Não encontrei essa dúvida. Pergunte direto para a Pluto.</div>}
      </div>

      <div data-anim="" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        {[
          ['mailto:ajuda@pluto.app', 'mail', 'ajuda@pluto.app', 'Resposta em até 1 dia útil'],
          ['tel:08000001234', 'smartphone', '0800 000 1234', 'Ouvidoria · seg. a sex., 8h às 20h'],
        ].map(([href, icon, title, sub]) => (
          <a key={href} href={href} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-foreground no-underline hover:text-foreground">
            <span className="grid size-[42px] place-items-center rounded-full bg-muted">
              <Icon icon={icon!} size={18} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{title}</span>
              <span className="text-xs text-muted-foreground">{sub}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
