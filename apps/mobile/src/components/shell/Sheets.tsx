import { AlertSchema, MeSchema, type Alert } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { z } from 'zod';
import { api } from '@/api';
import { fmtDay } from '@/lib/format';
import { MORE, type NavId, type PageId } from '@/lib/nav';
import { useTheme } from '@/lib/theme';
import { useQueryLite } from '@/lib/use-api';
import { PlutoLogo } from '../brand';
import { Icon } from '../Icon';
import { T } from '../T';
import { Btn, Sheet } from '../ui';

/** "Mais" do site: atalho para o Plutao e a grade com as outras paginas. */
export function MoreSheet({ visible, page, onClose, onNav, onChat }: { visible: boolean; page: PageId; onClose: () => void; onNav: (id: NavId) => void; onChat: () => void }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Pressable accessibilityRole="button" onPress={onChat} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 12, backgroundColor: t.brand }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <PlutoLogo size={34} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={15} weight={700} color="#FFFFFF">
            Fale com o Plutão
          </T>
          <T size={12} color="rgba(255,255,255,0.85)">
            “Posso comprar um celular de R$ 2.000?”
          </T>
        </View>
        <Icon icon="chevron-right" size={18} color="#FFFFFF" />
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {MORE.map(([id, label, icon]) => {
          const on = page === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onNav(id)}
              style={{ width: '25%', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 2, borderRadius: 14, backgroundColor: on ? t.brandSoft : 'transparent' }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 99, backgroundColor: t.muted, alignItems: 'center', justifyContent: 'center' }}>
                <Icon icon={icon} size={20} />
              </View>
              <T size={12} weight={500} color={on ? t.brandText : t.foreground} style={{ textAlign: 'center' }} numberOfLines={2}>
                {label}
              </T>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const ALERT_ICON: Record<Alert['type'], string> = {
  bill_due: 'calendar-days',
  month_negative: 'wallet',
  category_anomaly: 'trending-up',
  peak_goal: 'target',
  weekly_summary: 'file-text',
  limit_usage: 'pie-chart',
  limit_override: 'pie-chart',
};
const ALERT_PAGE: Record<NonNullable<Alert['action']>['page'], PageId> = { overview: 'overview', bills: 'bills', tx: 'tx', budget: 'budget', goals: 'goals', reports: 'reports' };
const loadAlerts = () => api.request('/alerts', {}, z.array(AlertSchema));

export function useAlerts() {
  return useQueryLite(loadAlerts, ['alerts']);
}

/** Painel do sino: fato, consequencia, acao, "por que" e util / nao util (como no site). */
export function AlertsSheet({ visible, onClose, onNav }: { visible: boolean; onClose: () => void; onNav: (id: PageId) => void }) {
  const t = useTheme();
  const qc = useQueryClient();
  const alerts = useAlerts();
  const [why, setWhy] = useState<string | null>(null);
  const fb = useMutation({
    mutationFn: ({ id, v }: { id: string; v: 'useful' | 'not_useful' }) => api.request(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ feedback: v }) }, AlertSchema),
    onSuccess: (n) => qc.setQueryData<Alert[]>(['alerts'], (list) => list?.map((x) => (x.id === n.id ? n : x))),
  });
  const list = (alerts.data ?? []).slice(0, 15);
  return (
    <Sheet visible={visible} onClose={onClose} title="Notificações">
      {!list.length && <T tone="muted">Tudo em dia. Nada para avisar agora.</T>}
      {list.map((a) => (
        <View key={a.id} style={{ gap: 8, borderRadius: 12, padding: 10, backgroundColor: a.readAt ? 'transparent' : t.brandSoft }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 99, backgroundColor: t.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Icon icon={ALERT_ICON[a.type]} size={16} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={14} weight={600}>
                {a.title}
              </T>
              <T size={13} style={{ lineHeight: 18 }}>
                {a.body}
              </T>
              <T size={12} tone="muted">
                {fmtDay(a.createdAt.toISOString())}
              </T>
            </View>
          </View>
          <View style={{ paddingLeft: 48, gap: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => setWhy(why === a.id ? null : a.id)}>
              <T size={12} weight={600} tone="brand">
                {why === a.id ? 'Esconder o porquê' : 'Por quê?'}
              </T>
            </Pressable>
            {why === a.id && a.why.map((w) => <T key={w} size={12} tone="muted">{`• ${w}`}</T>)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {a.action && <Btn small label={a.action.label} onPress={() => onNav(ALERT_PAGE[a.action!.page])} />}
              {a.feedback ? (
                <T size={12} tone="muted">
                  {a.feedback === 'useful' ? 'Obrigada! Você marcou como útil.' : 'Anotado: vamos avisar menos coisas assim.'}
                </T>
              ) : (
                <>
                  <Btn small kind="outline" label="Útil" onPress={() => fb.mutate({ id: a.id, v: 'useful' })} />
                  <Btn small kind="outline" label="Não útil" onPress={() => fb.mutate({ id: a.id, v: 'not_useful' })} />
                </>
              )}
            </View>
          </View>
        </View>
      ))}
    </Sheet>
  );
}

const USER_MENU: [NavId, string, string][] = [
  ['settings', 'user', 'Meu perfil'],
  ['settings', 'landmark', 'Contas conectadas'],
  ['help', 'circle-help', 'Ajuda'],
  ['logout', 'log-out', 'Sair'],
];
const loadMe = () => api.request('/me', {}, MeSchema);

/** Menu da conta (avatar do cabecalho). */
export function AccountSheet({ visible, onClose, onNav }: { visible: boolean; onClose: () => void; onNav: (id: NavId) => void }) {
  const t = useTheme();
  const me = useQueryLite(loadMe, ['me']);
  return (
    <Sheet visible={visible} onClose={onClose}>
      {me.data && (
        <View style={{ gap: 2, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <T size={15} weight={600}>
            {me.data.name}
          </T>
          <T size={13} tone="muted">
            {me.data.email}
          </T>
        </View>
      )}
      {USER_MENU.map(([id, icon, label]) => (
        <Pressable key={label} accessibilityRole="button" onPress={() => onNav(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
          <Icon icon={icon} size={18} color={t.mutedForeground} />
          <T size={15}>{label}</T>
        </Pressable>
      ))}
    </Sheet>
  );
}

/** Confirmacao de saida, como no site. */
export function LogoutSheet({ visible, onClose, onConfirm }: { visible: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Sair da conta?">
      <T tone="muted">Você vai precisar do CPF, da senha e do autenticador para entrar de novo.</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn grow kind="outline" label="Cancelar" onPress={onClose} />
        <Btn grow kind="danger" label="Sair" onPress={onConfirm} />
      </View>
    </Sheet>
  );
}
