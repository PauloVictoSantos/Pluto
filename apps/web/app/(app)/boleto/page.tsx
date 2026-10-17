'use client';

import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';

// Secao 1.2: emissao de boletos e Pix estao fora do escopo da v1 (o Pluto le dados, nao movimenta
// dinheiro). O design previa esta tela; ela volta quando houver integracao real de cobranca.
export default function BoletoPage() {
  const { nav } = useShell();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Boletos</h1>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <PlutoLogo size={76} />
        <div className="text-[17px] font-semibold">Emissão de boletos ainda não está disponível</div>
        <div className="max-w-[440px] text-sm leading-normal text-pretty text-muted-foreground">
          Nesta versão o Pluto só lê seus dados pelo Open Finance: ele não emite cobranças, não faz Pix e não paga contas. Para gerar boletos de verdade é
          preciso uma conta de cobrança num banco, o que fica para uma próxima versão.
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <button onClick={() => nav('bills')} className="btn btn-primary">
            <Icon icon="calendar-days" size={16} />
            Ver contas a pagar
          </button>
          <button onClick={() => nav('tx')} className="btn btn-outline">
            Ver extrato
          </button>
        </div>
      </div>
    </div>
  );
}
