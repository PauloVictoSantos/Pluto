'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { initials } from '@/lib/format';
import { animate, reducedMotion, stagger } from '@/lib/motion';
import { BOTTOM, MORE, ROUTES, SIDE_BOTTOM, SIDE_TOP, TABS, pageFromPath, type NavId, type PageId } from '@/lib/nav';
import { finishBoot, logout, setTheme, useApp } from '@/lib/store';
import { modeOf, useWidth } from '@/lib/viewport';
import { PlutoLogo } from '../brand/PlutoLogo';
import { PlutoMascot } from '../brand/PlutoMascot';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { ChatPanel } from './ChatPanel';
import { ShellContext } from './ShellContext';

const NOTIFICATIONS: { icon: string; title: string; time: string; go: PageId }[] = [
  { icon: 'circle-alert', title: 'Seguro do carro está atrasado', time: 'Venceu em 12 out.', go: 'bills' },
  { icon: 'calendar-days', title: 'Fatura Nubank vence em 25 out.', time: 'Hoje, 08:00', go: 'cards' },
  { icon: 'arrow-down-left', title: 'Pix de R$ 350,00 recebido de João', time: '10 out. 2026, 12:04', go: 'tx' },
];
const USER_MENU: [NavId, string, string][] = [
  ['settings', 'user', 'Meu perfil'],
  ['settings', 'landmark', 'Contas conectadas'],
  ['help', 'circle-help', 'Ajuda'],
  ['logout', 'log-out', 'Sair'],
];
const BOOT_MS = 2600;

function Tooltip({ label, side = 'bottom' }: { label: string; side?: 'bottom' | 'right' }) {
  const pos = side === 'right' ? 'left-[calc(100%+12px)] top-1/2 -translate-y-1/2' : 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2';
  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute z-45 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-primary-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${pos}`}
    >
      {label}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const page = pageFromPath(usePathname());
  const width = useWidth();
  const mode = modeOf(width), isMobile = mode === 'mobile', isDesktop = mode === 'desktop', isTablet = mode === 'tablet';

  const hydrated = useApp((s) => s.hydrated);
  const session = useApp((s) => s.session);
  const booting = useApp((s) => s.booting);
  const theme = useApp((s) => s.theme);
  const user = useApp((s) => s.user);

  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const fabAnimated = useRef(false);

  useEffect(() => {
    if (hydrated && !session) router.replace('/login');
  }, [hydrated, session, router]);

  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(finishBoot, BOOT_MS);
    return () => clearTimeout(t);
  }, [booting]);

  useEffect(() => {
    if (reducedMotion()) return;
    if (notifOpen && notifRef.current) animate(notifRef.current, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.2 });
  }, [notifOpen]);
  useEffect(() => {
    if (reducedMotion()) return;
    if (userOpen && userRef.current) animate(userRef.current, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.2 });
  }, [userOpen]);
  useEffect(() => {
    const el = moreRef.current;
    if (!moreOpen || !el || reducedMotion()) return;
    animate(el, { y: ['100%', '0%'] }, { type: 'spring', stiffness: 380, damping: 34 });
    animate(Array.from(el.querySelectorAll('button')), { opacity: [0, 1], y: [10, 0] }, { delay: stagger(0.025, { startDelay: 0.08 }), duration: 0.3 });
  }, [moreOpen]);

  const closeMenus = () => {
    setNotifOpen(false);
    setUserOpen(false);
  };

  const nav = useCallback(
    (id: NavId) => {
      setNotifOpen(false);
      setUserOpen(false);
      if (id === 'logout') {
        setMoreOpen(false);
        setLogoutOpen(true);
        return;
      }
      if (id === 'more') {
        setMoreOpen(true);
        return;
      }
      setMoreOpen(false);
      router.push(ROUTES[id]);
      window.scrollTo(0, 0);
    },
    [router, setNotifOpen, setUserOpen, setMoreOpen, setLogoutOpen],
  );
  const openChat = useCallback(() => {
    setMoreOpen(false);
    setChatOpen(true);
  }, [setMoreOpen, setChatOpen]);
  const closeChat = useCallback(() => setChatOpen(false), [setChatOpen]);

  const fabRef = useCallback((el: HTMLButtonElement | null) => {
    if (!el || fabAnimated.current || reducedMotion()) return;
    fabAnimated.current = true;
    animate(el, { scale: [0.4, 1], opacity: [0, 1] }, { type: 'spring', stiffness: 300, damping: 18, delay: 0.4 });
  }, []);

  if (!hydrated || !session) return null;

  const dark = theme === 'dark';
  const morePages = MORE.map((m) => m[0]);
  const asideTop = isDesktop ? 65 : 113;
  const showFab = !booting && !chatOpen && !(isMobile && page === 'boleto');
  const pill = (on: boolean) => ({ background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--primary-foreground)' : 'var(--muted-foreground)' });

  const tabs = (
    <nav className={`gap-1 rounded-full bg-muted p-1 ${isTablet ? 'inline-flex' : 'flex'}`} aria-label="Seções">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          onClick={() => nav(id)}
          aria-current={page === id ? 'page' : undefined}
          className="h-9 cursor-pointer rounded-full border-0 px-4 text-sm font-medium whitespace-nowrap"
          style={pill(page === id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  const sideButton = ([id, label, icon]: [NavId, string, string]) => {
    const on = page === id;
    return (
      <div key={id} className="group relative">
        <button
          onClick={() => nav(id)}
          aria-label={label}
          aria-current={on ? 'page' : undefined}
          className={`grid size-[46px] cursor-pointer place-items-center rounded-full border-0 ${on ? '' : 'hover:bg-muted'}`}
          style={pill(on)}
        >
          <Icon icon={icon} size={20} />
        </button>
        <Tooltip label={label} side="right" />
      </div>
    );
  };

  return (
    <ShellContext.Provider value={{ mode, nav, openChat }}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-background">
          <div className="flex h-16 items-center gap-3" style={{ padding: `0 ${isMobile ? 16 : 20}px` }}>
            <button onClick={() => nav('overview')} className="flex shrink-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-foreground">
              <PlutoLogo size={34} />
              <span className="text-[22px] font-extrabold tracking-[-0.04em]">pluto</span>
            </button>
            <div className="flex min-w-0 flex-1 justify-center">{isDesktop && tabs}</div>
            <div className="flex shrink-0 items-center gap-2">
              {width >= 1360 && (
                <label className="box-border flex h-10 w-[190px] items-center gap-2 rounded-full border border-border px-3.5 text-muted-foreground">
                  <Icon icon="search" size={16} />
                  <input
                    onKeyDown={(e) => e.key === 'Enter' && nav('tx')}
                    placeholder="Buscar transações"
                    aria-label="Buscar transações"
                    className="w-full border-0 bg-transparent text-sm text-foreground outline-none"
                  />
                </label>
              )}
              <div className="group relative">
                <button onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Modo claro' : 'Modo escuro'} className="icon-btn size-11">
                  <Icon icon={dark ? 'sun' : 'moon'} size={18} />
                </button>
                {!isMobile && <Tooltip label={dark ? 'Modo claro' : 'Modo escuro'} />}
              </div>
              <div className="group relative">
                <button
                  onClick={() => {
                    setNotifOpen(!notifOpen);
                    setUserOpen(false);
                  }}
                  aria-label="Notificações"
                  aria-expanded={notifOpen}
                  className="icon-btn relative size-11"
                >
                  <Icon icon="bell" size={18} />
                  <span className="absolute top-[9px] right-2.5 size-2 rounded-full border-2 border-card bg-brand" />
                </button>
                {!isMobile && !notifOpen && <Tooltip label="Notificações" />}
                {notifOpen && (
                  <>
                    <div onClick={closeMenus} className="fixed inset-0 z-40" />
                    <div
                      ref={notifRef}
                      className="z-41 box-border w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-card p-2 shadow-[0_12px_32px_rgba(0,0,0,.12)]"
                      style={isMobile ? { position: 'fixed', right: 12, top: 70 } : { position: 'absolute', right: 0, top: 52 }}
                    >
                      <div className="px-2.5 py-2 text-[13px] font-semibold text-muted-foreground">Notificações</div>
                      {NOTIFICATIONS.map((n) => (
                        <button
                          key={n.title}
                          onClick={() => nav(n.go)}
                          className="flex w-full cursor-pointer gap-3 rounded-xl border-0 bg-transparent p-2.5 text-left text-foreground hover:bg-muted"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                            <Icon icon={n.icon} size={16} />
                          </span>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-sm font-medium">{n.title}</span>
                            <span className="text-xs text-muted-foreground">{n.time}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => {
                    setUserOpen(!userOpen);
                    setNotifOpen(false);
                  }}
                  aria-label="Menu da conta"
                  aria-expanded={userOpen}
                  className="flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card pr-2 pl-[5px] text-foreground"
                >
                  <span className="grid size-[34px] place-items-center rounded-full bg-accent text-[13px] font-bold text-black">{initials(user.name)}</span>
                  <span className="flex text-muted-foreground">
                    <Icon icon="chevron-down" size={15} />
                  </span>
                </button>
                {userOpen && (
                  <>
                    <div onClick={closeMenus} className="fixed inset-0 z-40" />
                    <div ref={userRef} className="absolute top-[52px] right-0 z-41 w-[250px] rounded-2xl border border-border bg-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.12)]">
                      <div className="mb-1 border-b border-border px-3 py-2.5">
                        <div className="text-sm font-semibold">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </div>
                      {USER_MENU.map(([id, icon, label]) => (
                        <button
                          key={label}
                          onClick={() => nav(id)}
                          className="flex min-h-[42px] w-full cursor-pointer items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-3 text-left text-sm text-foreground hover:bg-muted"
                        >
                          <span className="flex text-muted-foreground">
                            <Icon icon={icon} size={16} />
                          </span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {isTablet && <div className="no-scrollbar overflow-x-auto px-5 pb-3">{tabs}</div>}
        </header>

        <div className="flex">
          {!isMobile && (
            <aside
              className="sticky z-20 box-border flex w-[76px] shrink-0 flex-col items-center gap-2 border-r border-border py-5"
              style={{ top: asideTop, height: `calc(100vh - ${asideTop}px)` }}
              aria-label="Atalhos"
            >
              {SIDE_TOP.map(sideButton)}
              <div className="flex-1" />
              {SIDE_BOTTOM.map(sideButton)}
            </aside>
          )}

          <main
            className="box-border min-w-0 max-w-[1480px] flex-1"
            style={{ padding: isMobile ? '16px 16px calc(120px + env(safe-area-inset-bottom))' : '28px 28px 120px' }}
          >
            {booting ? (
              <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
                <div className="h-[280px] w-[min(340px,86vw)]">
                  <PlutoMascot scene="yarn" talk={false} />
                </div>
                <div className="text-lg font-semibold">Organizando suas contas…</div>
                <div className="max-w-[320px] text-sm text-pretty text-muted-foreground">
                  Enquanto a Pluto briga com o novelo, buscamos seus dados no Open Finance.
                </div>
              </div>
            ) : (
              children
            )}
          </main>
        </div>

        {showFab && (
          <button
            ref={fabRef}
            onClick={openChat}
            aria-label="Abrir chat com a Pluto"
            className="fixed z-35 flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-dark-card text-sm font-semibold text-white shadow-[0_10px_28px_rgba(0,0,0,.22)]"
            style={{
              right: isMobile ? 16 : 24,
              bottom: isMobile ? 'calc(84px + env(safe-area-inset-bottom))' : 24,
              height: isMobile ? 56 : 60,
              padding: isMobile ? '0 7px' : '0 20px 0 10px',
            }}
          >
            <PlutoLogo size={40} />
            {!isMobile && <span className="whitespace-nowrap">Pergunte à Pluto</span>}
          </button>
        )}

        {isMobile && (
          <nav
            className="fixed inset-x-0 bottom-0 z-34 flex items-end border-t border-border bg-background px-1.5 pt-1.5 pb-[calc(8px+env(safe-area-inset-bottom))]"
            aria-label="Navegação principal"
          >
            {BOTTOM.map(([id, label, icon]) => {
              const on = id === 'more' ? moreOpen || morePages.includes(page) : page === id && !moreOpen;
              const center = id === 'boleto';
              return (
                <button
                  key={id}
                  onClick={() => nav(id)}
                  aria-label={label}
                  aria-current={on && id !== 'more' ? 'page' : undefined}
                  className="flex min-h-[54px] flex-1 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-semibold"
                  style={{ color: on ? 'var(--foreground)' : 'var(--muted-foreground)' }}
                >
                  <span
                    className="grid place-items-center rounded-full"
                    style={
                      center
                        ? { width: 52, height: 52, marginTop: -22, background: '#7D39EB', color: '#fff', boxShadow: '0 8px 20px rgba(125,57,235,.35)' }
                        : { width: 52, height: 30, background: on ? 'var(--accent)' : 'transparent', color: on ? '#000' : 'inherit' }
                    }
                  >
                    <Icon icon={icon} size={center ? 22 : 20} />
                  </span>
                  {label}
                </button>
              );
            })}
          </nav>
        )}

        {moreOpen && (
          <>
            <div onClick={() => setMoreOpen(false)} className="fixed inset-0 z-50 bg-overlay" />
            <div
              ref={moreRef}
              role="dialog"
              aria-label="Mais opções"
              className="fixed inset-x-0 bottom-0 z-51 flex flex-col gap-4 rounded-t-3xl border-t border-border bg-card px-4 pt-2.5 pb-[calc(20px+env(safe-area-inset-bottom))] text-foreground"
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-border" />
              <button onClick={openChat} className="flex cursor-pointer items-center gap-3 rounded-2xl border-0 bg-brand p-3 text-left text-white">
                <span className="grid size-11 place-items-center rounded-[14px] bg-white/15">
                  <PlutoLogo size={34} />
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-bold">Pergunte à Pluto</span>
                  <span className="text-xs opacity-85">“Quanto gastei com delivery este mês?”</span>
                </span>
                <Icon icon="chevron-right" size={18} />
              </button>
              <div className="grid grid-cols-4 gap-2">
                {MORE.map(([id, label, icon]) => {
                  const on = page === id;
                  return (
                    <button
                      key={id}
                      onClick={() => nav(id)}
                      className="flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border-0 px-0.5 py-2.5 text-center text-xs leading-[1.2] font-medium"
                      style={{ background: on ? 'var(--brand-soft)' : 'transparent', color: on ? 'var(--brand-text)' : 'var(--foreground)' }}
                    >
                      <span className="grid size-12 place-items-center rounded-full bg-muted">
                        <Icon icon={icon} size={20} />
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <ChatPanel open={chatOpen} onClose={closeChat} fullWidth={isMobile} />

        {logoutOpen && (
          <Sheet onClose={() => setLogoutOpen(false)} role="alertdialog" label="Sair da conta" width={380} top="30vh">
            <div className="flex items-center gap-3.5">
              <PlutoLogo size={48} />
              <div>
                <div className="text-[19px] font-bold tracking-[-0.02em]">Sair da conta?</div>
                <div className="mt-1 text-sm text-muted-foreground">Você vai precisar entrar de novo para ver seus dados.</div>
              </div>
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => setLogoutOpen(false)} className="btn btn-outline h-12 flex-1 text-[15px]">
                Cancelar
              </button>
              <button
                onClick={() => {
                  setLogoutOpen(false);
                  setChatOpen(false);
                  logout();
                }}
                className="btn btn-primary h-12 flex-1 text-[15px]"
              >
                Sair
              </button>
            </div>
          </Sheet>
        )}
      </div>
    </ShellContext.Provider>
  );
}
