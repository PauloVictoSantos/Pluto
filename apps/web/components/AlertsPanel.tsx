'use client';

import type { Alert } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTimeIn } from '@/lib/datetime';
import type { PageId } from '@/lib/nav';
import { useTz } from '@/lib/queries';
import { Why } from './Insight';
import { Icon } from './ui/Icon';

const ICON: Record<Alert['type'], string> = {
  bill_due: 'calendar-days',
  month_negative: 'wallet',
  category_anomaly: 'trending-up',
  peak_goal: 'target',
  weekly_summary: 'file-text',
};
const PAGE: Record<NonNullable<Alert['action']>['page'], PageId> = {
  overview: 'overview',
  bills: 'bills',
  tx: 'tx',
  budget: 'budget',
  goals: 'goals',
  reports: 'reports',
};

/** AlertCard (doc. "Componentes"): fato, consequencia, acao, "por que" e util / nao util (RN-A04). */
export function AlertCard({ a, onNav }: { a: Alert; onNav: (p: PageId) => void }) {
  const qc = useQueryClient();
  const tz = useTz();
  const fb = useMutation({
    mutationFn: (v: 'useful' | 'not_useful') => api.alertFeedback(a.id, v),
    onSuccess: (n) => qc.setQueryData<Alert[]>(['alerts'], (list) => list?.map((x) => (x.id === n.id ? n : x))),
  });
  return (
    <article className="flex flex-col gap-2 rounded-xl p-2.5" style={{ background: a.readAt ? 'transparent' : 'var(--brand-soft)' }}>
      <div className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
          <Icon icon={ICON[a.type]} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{a.title}</div>
          <div className="mt-0.5 text-[13px] leading-snug whitespace-pre-line text-foreground">{a.body}</div>
          <div className="mt-1 text-xs text-muted-foreground">{fmtDateTimeIn(a.createdAt, tz)}</div>
        </div>
      </div>
      <div className="pl-12">
        <Why>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {a.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Why>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-12">
        {a.action && (
          <button onClick={() => onNav(PAGE[a.action!.page])} className="btn btn-primary h-9 px-3 text-[13px]">
            {a.action.label}
          </button>
        )}
        {a.feedback ? (
          <span className="text-xs text-muted-foreground">{a.feedback === 'useful' ? 'Obrigada! Você marcou como útil.' : 'Anotado: vamos avisar menos coisas assim.'}</span>
        ) : (
          <span className="flex items-center gap-1" role="group" aria-label="Este aviso foi útil?">
            <button onClick={() => fb.mutate('useful')} disabled={fb.isPending} className="btn btn-outline h-9 px-3 text-[13px]">
              Útil
            </button>
            <button onClick={() => fb.mutate('not_useful')} disabled={fb.isPending} className="btn btn-outline h-9 px-3 text-[13px]">
              Não útil
            </button>
          </span>
        )}
      </div>
    </article>
  );
}
