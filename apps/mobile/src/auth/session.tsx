import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ApiError, api } from '@/api';
import { needsBiometric, shouldLock } from './flow';

// Sessao do app (guia mobile, secoes 5 e 7):
// - loading: lendo o Keychain/Keystore;
// - signedOut: sem sessao (login);
// - locked: tem sessao, mas precisa da biometria (ao abrir e ao voltar depois de 1 min);
// - signedIn: liberado.
export type SessionStatus = 'loading' | 'signedOut' | 'locked' | 'signedIn';

interface Session {
  status: SessionStatus;
  /** Aviso para a tela de login (sessao expirada, saiu da conta). */
  notice: string | null;
  /** Login concluido (depois do codigo do autenticador). */
  signedIn: () => void;
  unlock: () => Promise<void>;
  signOut: () => Promise<void>;
  unlockError: string | null;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fora do SessionProvider');
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    api.setOnSessionLost(() => {
      setNotice('Sua sessão expirou. Entre novamente.');
      setStatus('signedOut');
    });
    void api.hasSession().then((has) => setStatus(has ? 'locked' : 'signedOut'));
  }, []);

  // Voltou do segundo plano depois de 1 minuto: bloqueia de novo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') backgroundAt.current = Date.now();
      if (next === 'active') {
        if (shouldLock(backgroundAt.current, Date.now())) setStatus((s) => (s === 'signedIn' ? 'locked' : s));
        backgroundAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    setUnlockError(null);
    const check = { hasHardware: await LocalAuthentication.hasHardwareAsync(), enrolled: await LocalAuthentication.isEnrolledAsync() };
    if (needsBiometric(check)) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Desbloquear o Pluto', fallbackLabel: 'Usar senha do aparelho', cancelLabel: 'Cancelar' });
      if (!r.success) {
        if (r.error !== 'user_cancel' && r.error !== 'app_cancel' && r.error !== 'system_cancel') setUnlockError('Não foi possível confirmar sua identidade. Tente de novo.');
        return;
      }
    }
    // Confere a sessao no servidor; sem internet o app abre e as telas tentam de novo.
    try {
      if (!(await api.refresh()) && !(await api.hasSession())) {
        setNotice('Sua sessão expirou. Entre novamente.');
        setStatus('signedOut');
        return;
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'NETWORK')) throw e;
    }
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setNotice('Você saiu da sua conta.');
    setStatus('signedOut');
  }, []);

  const value = useMemo<Session>(
    () => ({ status, notice, unlockError, unlock, signOut, signedIn: () => (setNotice(null), setStatus('signedIn')) }),
    [status, notice, unlockError, unlock, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
