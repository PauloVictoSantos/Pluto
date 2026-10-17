import { Capacitor } from '@capacitor/core';

// Camada lib/native (secao 3.6): no navegador usa fallbacks; no app usa plugins Capacitor.
// Biometria, armazenamento seguro e notificacoes entram aqui na fase 4.
export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform() as 'ios' | 'android' | 'web';
