import { z } from 'zod';

// Alertas (doc. "Alertas", RN-A01..A05): painel do sino, push e e-mail.

export const ALERT_TYPES = ['bill_due', 'month_negative', 'category_anomaly', 'peak_goal', 'weekly_summary'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Telas para onde a acao do alerta leva. */
export const ALERT_PAGES = ['overview', 'bills', 'tx', 'budget', 'goals', 'reports'] as const;

export const AlertSchema = z.object({
  id: z.string(),
  type: z.enum(ALERT_TYPES),
  /** O fato ("Delivery está 40% acima do seu normal"). */
  title: z.string(),
  /** A consequencia para a prioridade, sem culpa (RN-A05). */
  body: z.string(),
  action: z.object({ label: z.string(), page: z.enum(ALERT_PAGES) }).nullable(),
  /** O "porque": os numeros e a regra que dispararam (RN-G06). */
  why: z.array(z.string()),
  createdAt: z.coerce.date(),
  readAt: z.coerce.date().nullable(),
  /** Enviado por push/e-mail (null: so no painel). */
  sentAt: z.coerce.date().nullable(),
  feedback: z.enum(['useful', 'not_useful']).nullable(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertFeedbackSchema = z.object({ feedback: z.enum(['useful', 'not_useful']) });

export const AlertSettingsSchema = z.object({
  push: z.boolean(),
  email: z.boolean(),
  /** O servidor tem chaves VAPID (sem elas, nao ha push). */
  pushAvailable: z.boolean(),
  /** O servidor tem o Resend configurado. */
  emailAvailable: z.boolean(),
  publicKey: z.string().nullable(),
  devices: z.number().int(),
});
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;
export const UpdateAlertSettingsSchema = z.object({ push: z.boolean().optional(), email: z.boolean().optional() });

/**
 * Inscricao Web Push do navegador. O endpoint precisa ser de um servico de push conhecido: o servidor
 * faz requisicoes para ele, entao um endereco qualquer abriria brecha para SSRF.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];
export const isPushEndpoint = (url: string) => {
  // Sem usuario/senha na URL ("https://x@host"), so https e host conhecido.
  const host = /^https:\/\/([a-z0-9.-]+)(?::443)?\//i.exec(url)?.[1]?.toLowerCase();
  return !!host && PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
};
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, 'Serviço de push desconhecido'),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});
export const PushUnsubscribeSchema = z.object({ endpoint: z.string().max(1000) });
