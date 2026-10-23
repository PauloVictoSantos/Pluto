import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { setValuesHidden } from './format';

// Tokens do design "Pluto App" (mesmos de apps/web/app/globals.css), claro e escuro.
const light = {
  background: '#FFFFFF',
  foreground: '#000000',
  card: '#FFFFFF',
  muted: '#F4F4F5',
  mutedForeground: '#6B6B73',
  border: '#E8E8EC',
  primary: '#000000',
  primaryForeground: '#FFFFFF',
  brand: '#7D39EB',
  brandText: '#6A2AD6',
  brandSoft: 'rgba(125,57,235,0.10)',
  accent: '#C6FF33',
  accentForeground: '#000000',
  darkCard: '#000000',
  dangerSoft: '#FDECEC',
  dangerText: '#B42318',
  overlay: 'rgba(0,0,0,0.35)',
  lilac: '#B18CF7',
  /** Fundo do bloco de saude financeira (gradiente no site: ceu -> branco -> lima). */
  healthFrom: '#DCEFFF',
  healthTo: '#EEF9D2',
  healthCard: 'rgba(255,255,255,0.72)',
};
const dark: typeof light = {
  ...light,
  background: '#000000',
  foreground: '#FAFAFA',
  card: '#0F0F11',
  muted: '#1A1A1E',
  mutedForeground: '#A1A1AA',
  border: '#26262C',
  primary: '#FFFFFF',
  primaryForeground: '#000000',
  brandText: '#B18CF7',
  brandSoft: 'rgba(125,57,235,0.22)',
  darkCard: '#1C1C21',
  dangerSoft: 'rgba(248,113,113,0.14)',
  dangerText: '#FCA5A5',
  overlay: 'rgba(0,0,0,0.65)',
  healthFrom: '#0F1B2B',
  healthTo: '#141A0B',
  healthCard: 'rgba(255,255,255,0.06)',
};
export type Theme = typeof light & { dark: boolean };

type Mode = 'system' | 'light' | 'dark';
interface Prefs {
  theme: Theme;
  mode: Mode;
  setMode: (m: Mode) => void;
  /** Ocultar valores (olho do cabecalho): todo dinheiro vira R$ ••••. */
  hideValues: boolean;
  setHideValues: (h: boolean) => void;
}

// Preferencias de tela (nao sao dados financeiros): ficam no aparelho.
const MODE_KEY = 'pluto.pref.theme';
const HIDE_KEY = 'pluto.pref.hide';

const Ctx = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>('system');
  const [hideValues, setHide] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(MODE_KEY).then((m) => m && setModeState(m as Mode));
    void SecureStore.getItemAsync(HIDE_KEY).then((h) => {
      setValuesHidden(h === '1');
      setHide(h === '1');
    });
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    void SecureStore.setItemAsync(MODE_KEY, m);
  }, []);
  const setHideValues = useCallback((h: boolean) => {
    setValuesHidden(h);
    setHide(h);
    void SecureStore.setItemAsync(HIDE_KEY, h ? '1' : '0');
  }, []);

  const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
  const value = useMemo<Prefs>(
    () => ({ theme: { ...(isDark ? dark : light), dark: isDark }, mode, setMode, hideValues, setHideValues }),
    [isDark, mode, setMode, hideValues, setHideValues],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const p = useContext(Ctx);
  if (!p) throw new Error('usePrefs fora do PrefsProvider');
  return p;
}

export const useTheme = (): Theme => usePrefs().theme;
