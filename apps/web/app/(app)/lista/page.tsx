'use client';

import {
  SHOPPING_CATEGORIES,
  UNITS,
  normalizeItemName,
  shoppingCategoryOf,
  type ShoppingCategory,
  type ShoppingEntry,
  type ShoppingList,
  type Unit,
} from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { Sheet, useSheetClose } from '@/components/ui/Sheet';
import { ApiRequestError, api } from '@/lib/api';
import { ymdIn } from '@/lib/datetime';
import { fmtDay, maskMoney, hidePct } from '@/lib/format';
import { ReceiptScanner } from '@/components/ReceiptScanner';
import { ShoppingInsightsCard } from '@/components/ShoppingInsightsCard';
import { useEnter } from '@/lib/motion';
import { monthLong, monthLower, money, useTz } from '@/lib/queries';

// Aba Lista de compras (doc. "Telas"): responde "o que falta comprar?" e termina em "marcar comprado".
// Todo numero vem pronto do servidor; o navegador so mostra (doc. "O que o front-end nao pode fazer").

const KEY = ['shopping', 'list'];
const UNDO_MS = 5000;

interface Undo {
  label: string;
  run: () => Promise<unknown>;
  /** Acao extra no aviso (ex.: informar preco depois de marcar). */
  extra?: { label: string; onClick: () => void };
}

const qtyText = (e: { qty: number; unit: Unit }) => `${String(e.qty).replace('.', ',')} ${e.unit}`;

/** Mantem a tela acesa enquanto a lista esta aberta no celular (uso dentro do mercado). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = () => {
      if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    };
    req();
    document.addEventListener('visibilitychange', req);
    return () => {
      document.removeEventListener('visibilitychange', req);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener('online', up);
    window.addEventListener('offline', up);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', up);
    };
  }, []);
  return online;
}

export default function ListaPage() {
  const { mode } = useShell();
  const isMobile = mode === 'mobile', desk = mode === 'desktop';
  const tz = useTz();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);
  useWakeLock(isMobile);
  const online = useOnline();

  const q = useQuery({ queryKey: KEY, queryFn: api.shoppingList });
  const list = q.data;
  const set = (l: ShoppingList) => qc.setQueryData(KEY, l);

  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState('');
  const [priceFor, setPriceFor] = useState<ShoppingEntry | null>(null);
  const [showBought, setShowBought] = useState(false);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const fail = (e: unknown) => {
    setError(e instanceof ApiRequestError && e.status < 500 ? e.message : 'Não conseguimos salvar. Tente de novo.');
    void qc.invalidateQueries({ queryKey: KEY });
  };

  /** Atualizacao otimista: a tela muda na hora e a resposta do servidor confirma (< 100 ms). */
  const patch = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: Parameters<typeof api.updateShoppingEntry>[1] }) => api.updateShoppingEntry(itemId, body),
    onMutate: ({ itemId, body }) => {
      setError('');
      const cur = qc.getQueryData<ShoppingList>(KEY);
      if (!cur) return;
      set({
        ...cur,
        entries: cur.entries
          .filter((e) => !(e.itemId === itemId && body.removed))
          .map((e) =>
            e.itemId !== itemId
              ? e
              : {
                  ...e,
                  ...(body.bought !== undefined ? { bought: body.bought, boughtAt: body.bought ? new Date() : null, ...(body.bought ? {} : { priceMinor: null }) } : {}),
                  ...(body.priceMinor !== undefined ? { priceMinor: body.priceMinor } : {}),
                  ...(body.qty !== undefined ? { qty: body.qty } : {}),
                },
          ),
      });
    },
    onSuccess: set,
    onError: fail,
  });

  const toggle = (e: ShoppingEntry) => {
    const bought = !e.bought;
    patch.mutate({ itemId: e.itemId, body: { bought } });
    setUndo({
      label: bought ? `${e.name} comprado` : `${e.name} desmarcado`,
      run: () => api.updateShoppingEntry(e.itemId, { bought: e.bought, ...(e.bought && e.priceMinor !== null ? { priceMinor: e.priceMinor } : {}) }).then(set),
      extra: bought ? { label: 'Informar preço', onClick: () => setPriceFor({ ...e, bought: true }) } : undefined,
    });
  };
  const remove = (e: ShoppingEntry) => {
    patch.mutate({ itemId: e.itemId, body: { removed: true } });
    setUndo({ label: `${e.name} removido`, run: () => api.updateShoppingEntry(e.itemId, { removed: false }).then(set) });
  };
  const runUndo = () => {
    if (!undo) return;
    setUndo(null);
    undo.run().catch(fail);
  };

  // Ctrl+Z desfaz a ultima acao (desktop).
  useEffect(() => {
    if (!undo) return;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !(ev.target instanceof HTMLInputElement)) {
        ev.preventDefault();
        setUndo(null);
        undo.run().catch(fail);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // fail e estavel o bastante: so reinstala quando a acao desfazivel muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo]);

  const accept = useMutation({ mutationFn: (itemId: string) => api.addShoppingEntry({ itemId }), onSuccess: set, onError: fail });
  const dismiss = useMutation({ mutationFn: api.dismissSuggestion, onSuccess: set, onError: fail });

  if (q.isPending) return <Skeleton />;
  if (q.isError || !list)
    return (
      <div className="card flex flex-col items-start gap-3">
        <div className="text-sm">Não conseguimos carregar sua lista.</div>
        <button onClick={() => q.refetch()} className="btn btn-outline">
          Tentar de novo
        </button>
      </div>
    );

  const pending = list.entries.filter((e) => !e.bought);
  const bought = list.entries.filter((e) => e.bought);
  const total = list.entries.length;
  const paid = bought.reduce((s, e) => s + (e.priceMinor ?? 0), 0);
  const groups = SHOPPING_CATEGORIES.map((c) => ({ ...c, items: pending.filter((e) => e.category === c.key) })).filter((g) => g.items.length);
  const disabled = !online;

  const header = (
    <div data-anim="" className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="page-title m-0">Lista de {monthLower(list.month)}</h1>
        <span className="text-[13px] whitespace-nowrap text-muted-foreground">
          {list.closesInDays <= 1 ? 'Fecha amanhã' : `Fecha em ${list.closesInDays} dias`}
        </span>
      </div>
      <ReceiptScanner />
      {total > 0 && (
        <>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={bought.length}
            aria-label="Itens comprados"
          >
            <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${(bought.length / total) * 100}%` }} />
          </div>
          <div className="text-[13px] text-muted-foreground" aria-live="polite">
            {bought.length} de {total} comprados
          </div>
        </>
      )}
    </div>
  );

  const suggestions = list.suggestions.length > 0 && (
    <section data-anim="" className="card flex flex-col gap-2.5" aria-label="Sugestões do mês">
      <div className="card-title">Sugestões do mês</div>
      <div className="flex flex-wrap gap-2">
        {list.suggestions.map((s) => (
          <span key={s.itemId} className="inline-flex items-center rounded-full border border-brand bg-brand-soft text-brand-text">
            <button
              onClick={() => accept.mutate(s.itemId)}
              disabled={disabled || accept.isPending}
              title={s.reason}
              aria-label={`Adicionar ${s.name}. ${s.reason}`}
              className="flex h-11 cursor-pointer items-center gap-1 border-0 bg-transparent pr-1 pl-3.5 text-sm font-semibold text-inherit"
            >
              <Icon icon="plus" size={14} />
              {s.name}
            </button>
            <button
              onClick={() => dismiss.mutate(s.itemId)}
              disabled={disabled}
              aria-label={`Dispensar ${s.name}`}
              className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-inherit"
            >
              <Icon icon="x" size={14} />
            </button>
          </span>
        ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-muted-foreground">
        {list.suggestions.slice(0, 4).map((s) => (
          <li key={s.itemId}>
            <b className="font-semibold">{s.name}:</b> {s.reason.charAt(0).toLowerCase() + s.reason.slice(1)}
            {s.source === 'explore' && ' · vale testar de novo'}
          </li>
        ))}
      </ul>
    </section>
  );

  const items = (
    <section data-anim="" className="card flex flex-col gap-1" aria-label="Itens da lista">
      {total === 0 ? (
        <div className="flex flex-col items-start gap-1 py-2">
          <div className="text-base font-semibold">Comece pelos 5 itens que você mais compra.</div>
          <div className="text-sm text-muted-foreground">
            No mês que vem, a Pluto sugere a lista com base no que você comprou e no que deixou de lado.
          </div>
        </div>
      ) : pending.length === 0 ? (
        <div className="py-2 text-sm text-muted-foreground">Tudo comprado. Bom trabalho.</div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="flex flex-col">
            <div className="pt-2 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.label}</div>
            {g.items.map((e) => (
              <ChecklistItem key={e.itemId} e={e} disabled={disabled} onToggle={() => toggle(e)} onRemove={() => remove(e)} />
            ))}
          </div>
        ))
      )}

      {bought.length > 0 && (
        <div className="mt-2 flex flex-col">
          <button
            onClick={() => setShowBought((v) => !v)}
            aria-expanded={showBought}
            className="flex min-h-11 cursor-pointer items-center justify-between rounded-xl border-0 bg-muted px-3 text-sm font-semibold text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Icon icon={showBought ? 'chevron-down' : 'chevron-right'} size={16} />
              Comprados ({bought.length})
            </span>
            {paid > 0 && <span className="tabular-nums">{money(paid)}</span>}
          </button>
          {showBought &&
            bought.map((e) => (
              <ChecklistItem
                key={e.itemId}
                e={e}
                disabled={disabled}
                onToggle={() => toggle(e)}
                onRemove={() => remove(e)}
                onPrice={() => setPriceFor(e)}
              />
            ))}
        </div>
      )}
    </section>
  );

  const side = (
    <>
      {list.marketPrompt && pending.length > 0 && <MarketPrompt list={list} tz={tz} onDone={set} onError={fail} />}
      <Estimate list={list} />
      {list.basket && (
        <div data-anim="" className="card flex flex-col gap-1">
          <div className="text-[13px] text-muted-foreground">Preço da sua cesta</div>
          <div className="text-base font-semibold">
            {list.basket.pct === 0
              ? `Sua cesta custa o mesmo que em ${monthLong(list.basket.sinceMonth).toLowerCase()}`
              : `Sua cesta ficou ${hidePct(`${Math.abs(list.basket.pct).toString().replace('.', ',')}%`)} ${list.basket.pct > 0 ? 'mais cara' : 'mais barata'} desde ${monthLong(list.basket.sinceMonth).toLowerCase()}`}
          </div>
          <div className="text-xs text-muted-foreground">
            Por quê: mesmos {list.basket.items} itens, nas quantidades de {monthLower(list.basket.sinceMonth)}, comparando só o preço.
          </div>
        </div>
      )}
      {list.rarely.length > 0 && <Rarely list={list} disabled={disabled} onAdd={(id) => accept.mutate(id)} />}
      <History disabled={disabled} onCopied={set} onError={fail} />
    </>
  );

  return (
    <div ref={root} className="flex flex-col gap-4" style={{ paddingBottom: isMobile ? 84 : 0 }}>
      {!online && (
        <div role="status" className="rounded-xl bg-muted px-3.5 py-2 text-[13px] text-muted-foreground">
          Sem conexão. Marcar e adicionar voltam quando a internet voltar.
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}

      {desk ? (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)' }}>
          <div className="flex flex-col gap-4">
            {header}
            <AddBar disabled={disabled} onAdded={set} onError={fail} />
            {items}
          </div>
          <div className="flex flex-col gap-4">
            {suggestions}
            <ShoppingInsightsCard />
            {side}
          </div>
        </div>
      ) : (
        <>
          {header}
          {suggestions}
          <ShoppingInsightsCard />
          {items}
          {side}
          {/* Campo no rodape: ao alcance do polegar, acima da barra inferior e longe do botao da Pluto. */}
          <div className="fixed inset-x-0 z-30 bg-background px-3 pt-2 pb-2" style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))', paddingRight: isMobile ? 84 : 12 }}>
            <AddBar disabled={disabled} onAdded={set} onError={fail} compact />
          </div>
        </>
      )}

      {undo && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 z-40 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-dark-card py-2 pr-2 pl-4 text-sm text-white shadow-[0_10px_28px_rgba(0,0,0,.22)]"
          style={{ bottom: isMobile ? 'calc(148px + env(safe-area-inset-bottom))' : 24 }}
        >
          <span className="truncate">{undo.label}</span>
          {undo.extra && (
            <button
              onClick={() => {
                undo.extra!.onClick();
                setUndo(null);
              }}
              className="h-9 cursor-pointer rounded-full border-0 bg-transparent px-2 font-semibold text-white underline"
            >
              {undo.extra.label}
            </button>
          )}
          <button onClick={runUndo} className="flex h-9 cursor-pointer items-center gap-1 rounded-full border-0 bg-white px-3 font-semibold text-black">
            <Icon icon="undo-2" size={14} />
            Desfazer
          </button>
        </div>
      )}

      {priceFor && (
        <PriceSheet
          entry={priceFor}
          onClose={() => setPriceFor(null)}
          onSave={(priceMinor) => patch.mutate({ itemId: priceFor.itemId, body: { priceMinor } })}
        />
      )}
    </div>
  );
}

/** Linha inteira e area de toque. Celular: deslizar para a direita marca, para a esquerda remove. */
function ChecklistItem({ e, disabled, onToggle, onRemove, onPrice }: { e: ShoppingEntry; disabled: boolean; onToggle: () => void; onRemove: () => void; onPrice?: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const SWIPE = 80;

  const down = (ev: PointerEvent) => {
    if (ev.pointerType !== 'touch') return;
    start.current = { x: ev.clientX, y: ev.clientY };
    swiped.current = false;
  };
  const move = (ev: PointerEvent) => {
    if (!start.current) return;
    const x = ev.clientX - start.current.x, y = ev.clientY - start.current.y;
    if (Math.abs(x) > 10 && Math.abs(x) > Math.abs(y)) setDx(Math.max(-120, Math.min(120, x)));
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    // Um arrasto nao vira clique no fim do gesto.
    swiped.current = Math.abs(dx) > 10;
    if (dx >= SWIPE && !e.bought) onToggle();
    else if (dx <= -SWIPE) onRemove();
    setDx(0);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      onRemove();
    }
  };

  return (
    <div className="group relative overflow-hidden border-t border-border first:border-t-0">
      {dx !== 0 && (
        <div className="absolute inset-0 flex items-center justify-between px-4 text-sm font-semibold" aria-hidden>
          <span className="text-brand-text">{dx > 0 ? 'Comprado' : ''}</span>
          <span className="text-danger-text">{dx < 0 ? 'Remover' : ''}</span>
        </div>
      )}
      <div className="relative flex items-center bg-card" style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}>
        <button
          type="button"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            start.current = null;
            setDx(0);
          }}
          onClick={() => {
            if (swiped.current) swiped.current = false;
            else onToggle();
          }}
          onKeyDown={key}
          disabled={disabled}
          aria-pressed={e.bought}
          aria-label={`${e.name}, ${qtyText(e)}. ${e.bought ? 'Comprado. Desmarcar' : 'Marcar como comprado'}`}
          className="flex min-h-14 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent px-1 py-2 text-left text-foreground"
        >
          <span
            className="grid size-6 shrink-0 place-items-center rounded-md border-2"
            style={{ borderColor: e.bought ? 'var(--accent)' : 'var(--border)', background: e.bought ? 'var(--accent)' : 'transparent', color: '#000' }}
          >
            {e.bought && <Icon icon="check" size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`flex items-center gap-1.5 text-[15px] ${e.bought ? 'text-muted-foreground line-through' : 'font-medium'}`}>
              <span className="truncate">{e.name}</span>
              {e.class === 'maybe' && !e.bought && <span className="badge border-border text-muted-foreground">talvez</span>}
            </span>
            {e.reason && !e.bought && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{e.reason}</span>}
          </span>
          <span className="flex shrink-0 flex-col items-end text-sm text-muted-foreground tabular-nums">
            {qtyText(e)}
            {e.bought && e.priceMinor !== null ? <span className="text-xs">{money(e.priceMinor)}</span> : null}
          </span>
        </button>
        {onPrice && (
          <button onClick={onPrice} disabled={disabled} aria-label={`Informar preço de ${e.name}`} className="icon-btn ml-1 size-11 border-0">
            <Icon icon="banknote" size={16} />
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remover ${e.name}`}
          className="icon-btn ml-1 size-11 border-0 opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        >
          <Icon icon="trash-2" size={16} />
        </button>
      </div>
    </div>
  );
}

/** Adicionar item: autocompletar do catalogo; nome novo passa pela padronizacao (Gemini) e o usuario confirma. */
function AddBar({ disabled, onAdded, onError, compact }: { disabled: boolean; onAdded: (l: ShoppingList) => void; onError: (e: unknown) => void; compact?: boolean }) {
  const [raw, setRaw] = useState('');
  const [qty, setQty] = useState('1');
  const [confirm, setConfirm] = useState<{ raw: string; qty: number; name: string; category: ShoppingCategory; unit: Unit; known: boolean } | null>(null);
  const catalog = useQuery({ queryKey: ['shopping', 'catalog'], queryFn: api.shoppingCatalog });
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  const norm = normalizeItemName(raw);
  const matches = norm ? (catalog.data ?? []).filter((i) => normalizeItemName(i.name).includes(norm)).slice(0, 5) : [];
  const exact = (catalog.data ?? []).find((i) => normalizeItemName(i.name) === norm);
  const n = Math.max(0.01, Number(qty.replace(',', '.')) || 1);

  const done = (l: ShoppingList) => {
    onAdded(l);
    setRaw('');
    setQty('1');
    setConfirm(null);
    void qc.invalidateQueries({ queryKey: ['shopping', 'catalog'] });
    input.current?.focus();
  };
  const add = useMutation({ mutationFn: api.addShoppingEntry, onSuccess: done, onError });
  const resolve = useMutation({
    mutationFn: api.resolveItem,
    onSuccess: (r, text) => {
      if (r.source === 'catalog' && r.item) return add.mutate({ itemId: r.item.id, qty: n });
      const p = r.proposal ?? { name: r.item!.name, category: r.item!.category, unit: r.item!.unit };
      setConfirm({ raw: text, qty: n, name: r.item?.name ?? p.name, category: r.item?.category ?? p.category, unit: r.item?.unit ?? p.unit, known: !!r.item });
    },
    onError,
  });

  const submit = (ev?: FormEvent) => {
    ev?.preventDefault();
    const text = raw.trim();
    if (!text || disabled) return;
    if (exact) add.mutate({ itemId: exact.id, qty: n });
    else resolve.mutate(text);
  };
  const busy = add.isPending || resolve.isPending;

  return (
    <>
      <form onSubmit={submit} className={compact ? 'relative flex items-center gap-2' : 'card relative flex items-center gap-2'}>
        <label className="sr-only" htmlFor="add-item">
          Adicionar item
        </label>
        <input
          id="add-item"
          ref={input}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Adicionar item…"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={60}
          disabled={disabled}
          className="input h-12 flex-1 rounded-full"
          aria-autocomplete="list"
          aria-controls="add-item-options"
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/[^\d,.]/g, '').slice(0, 5))}
          inputMode="decimal"
          aria-label="Quantidade"
          className="input h-12 w-14 rounded-full px-2 text-center"
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || busy || !raw.trim()} aria-label="Adicionar" className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-primary text-primary-foreground disabled:opacity-50">
          <Icon icon={busy ? 'refresh-cw' : 'plus'} size={18} />
        </button>
        {matches.length > 0 && !exact && (
          <ul
            id="add-item-options"
            role="listbox"
            className={`absolute inset-x-0 z-10 m-0 flex list-none flex-col rounded-2xl border border-border bg-card p-1 shadow-lg ${compact ? 'bottom-full mb-2' : 'top-full mt-1'}`}
          >
            {matches.map((m) => (
              <li key={m.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => add.mutate({ itemId: m.id, qty: n })}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl border-0 bg-transparent px-3 text-left text-sm text-foreground hover:bg-muted"
                >
                  {m.name}
                  <span className="text-xs text-muted-foreground">{shoppingCategoryOf(m.category).label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      {confirm && (
        <ConfirmItem
          value={confirm}
          busy={add.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={(c) => add.mutate({ raw: confirm.raw, qty: confirm.qty, confirm: c })}
        />
      )}
    </>
  );
}

/** O usuario confirma o item canonico proposto; o nome digitado vira apelido (doc. "Padronizacao"). */
function ConfirmItem({
  value,
  busy,
  onClose,
  onConfirm,
}: {
  value: { raw: string; name: string; category: ShoppingCategory; unit: Unit; known: boolean };
  busy: boolean;
  onClose: () => void;
  onConfirm: (c: { name: string; category: ShoppingCategory; unit: Unit }) => void;
}) {
  const [name, setName] = useState(value.name);
  const [category, setCategory] = useState(value.category);
  const [unit, setUnit] = useState(value.unit);
  return (
    <Sheet
      onClose={onClose}
      label="Confirmar item"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onConfirm({ name: name.trim(), category, unit });
      }}
    >
      <div className="text-lg font-semibold">{value.known ? 'Este item já está no seu catálogo' : 'Adicionar como'}</div>
      <div className="text-sm text-muted-foreground">
        Você digitou “{value.raw}”. {value.known ? 'Vamos somar ao item que você já tem.' : 'Confira o nome e a categoria. Da próxima vez, ele aparece direto.'}
      </div>
      <label className="field">
        Nome do item
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="input" disabled={value.known} />
      </label>
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <label className="field">
          Categoria
          <select value={category} onChange={(e) => setCategory(e.target.value as ShoppingCategory)} className="input" disabled={value.known}>
            {SHOPPING_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Unidade
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="input" disabled={value.known}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SheetActions busy={busy} primary="Adicionar à lista" />
    </Sheet>
  );
}

function SheetActions({ busy, primary, secondary = 'Cancelar' }: { busy: boolean; primary: string; secondary?: string }) {
  const close = useSheetClose();
  return (
    <div className="flex gap-2">
      <button type="button" onClick={close} className="btn btn-outline h-12 flex-1">
        {secondary}
      </button>
      <button type="submit" disabled={busy} className="btn btn-primary h-12 flex-1">
        {busy ? 'Salvando…' : primary}
      </button>
    </div>
  );
}

/** Preco opcional depois de marcar: "pular" em destaque (doc. "Interacoes da lista"). */
function PriceSheet({ entry, onClose, onSave }: { entry: ShoppingEntry; onClose: () => void; onSave: (priceMinor: number | null) => void }) {
  const [amount, setAmount] = useState(entry.priceMinor ? maskMoney(String(entry.priceMinor)) : { text: '', value: 0 });
  return (
    <Sheet
      onClose={onClose}
      label="Preço pago"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(amount.value ? Math.round(amount.value * 100) : null);
        onClose();
      }}
    >
      <div className="text-lg font-semibold">Quanto pagou em {entry.name}?</div>
      <div className="text-sm text-muted-foreground">Opcional. Com o preço, a Pluto estima o que falta e acompanha quanto sua cesta encarece.</div>
      <input
        autoFocus
        value={amount.text}
        onChange={(e) => setAmount(maskMoney(e.target.value))}
        inputMode="numeric"
        placeholder="R$ 0,00"
        aria-label={`Preço de ${qtyText(entry)} de ${entry.name}`}
        className="input h-14 text-2xl font-bold"
      />
      <SheetActions busy={false} primary="Salvar preço" secondary="Pular" />
    </Sheet>
  );
}

/** Previsao como faixa, nunca valor unico (RN-M05). */
function Estimate({ list }: { list: ShoppingList }) {
  const e = list.estimate;
  if (!e) return null;
  return (
    <div data-anim="" className="card flex flex-col gap-1">
      <div className="text-[13px] text-muted-foreground">Estimativa do que falta</div>
      {e.pricedItems ? (
        <>
          <div className="text-xl font-bold tabular-nums">
            {e.lowMinor === e.highMinor ? money(e.lowMinor) : `${money(e.lowMinor)} a ${money(e.highMinor)}`}
          </div>
          <div className="text-xs text-muted-foreground">
            Por quê: menor e maior preço que você pagou recentemente, em {e.pricedItems} de {e.totalItems} {e.totalItems > 1 ? 'itens' : 'item'}.
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">Informe o preço ao marcar um item e a estimativa aparece aqui.</div>
      )}
    </div>
  );
}

/** Compra de mercado no banco: pergunta, nunca marca sozinho (RN-L07). */
function MarketPrompt({ list, tz, onDone, onError }: { list: ShoppingList; tz: string; onDone: (l: ShoppingList) => void; onError: (e: unknown) => void }) {
  const p = list.marketPrompt!;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const send = useMutation({ mutationFn: (ids: string[]) => api.answerMarket(p.transactionId, ids), onSuccess: onDone, onError });
  const pending = list.entries.filter((e) => !e.bought);
  return (
    <section data-anim="" className="card flex flex-col gap-2" aria-label="Compra no mercado">
      <div className="card-title">O que você comprou?</div>
      <div className="text-[13px] text-muted-foreground">
        Vimos uma compra em {p.label} em {fmtDay(ymdIn(p.date, tz))}, de {money(Math.abs(p.amountMinor))}. Marque o que levou.
      </div>
      <div className="flex flex-col">
        {pending.map((e) => (
          <label key={e.itemId} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={chosen.has(e.itemId)}
              onChange={() => setChosen((s) => (s.has(e.itemId) ? new Set([...s].filter((x) => x !== e.itemId)) : new Set([...s, e.itemId])))}
              className="size-5 accent-brand"
            />
            {e.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => send.mutate([])} disabled={send.isPending} className="btn btn-outline h-11 flex-1">
          Agora não
        </button>
        <button onClick={() => send.mutate([...chosen])} disabled={send.isPending || !chosen.size} className="btn btn-primary h-11 flex-1">
          Marcar {chosen.size || ''} como comprado{chosen.size > 1 ? 's' : ''}
        </button>
      </div>
    </section>
  );
}

function Rarely({ list, disabled, onAdd }: { list: ShoppingList; disabled: boolean; onAdd: (itemId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section data-anim="" className="card flex flex-col gap-1" aria-label="Você costuma não comprar">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left text-foreground">
        <span className="card-title">Você costuma não comprar ({list.rarely.length})</span>
        <Icon icon={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      {open &&
        list.rarely.map((r) => (
          <div key={r.itemId} className="flex min-h-12 items-center gap-3 border-t border-border py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.reason}</div>
            </div>
            <button onClick={() => onAdd(r.itemId)} disabled={disabled} className="btn btn-outline h-11 px-3 text-[13px]">
              <Icon icon="plus" size={14} />
              Adicionar
            </button>
          </div>
        ))}
    </section>
  );
}

/** Meses fechados: so leitura; da para copiar itens para a lista atual (RN-L06). */
function History({ disabled, onCopied, onError }: { disabled: boolean; onCopied: (l: ShoppingList) => void; onError: (e: unknown) => void }) {
  const hist = useQuery({ queryKey: ['shopping', 'history'], queryFn: api.shoppingHistory });
  const [month, setMonth] = useState<string | null>(null);
  if (!hist.data?.length) return null;
  return (
    <section data-anim="" className="card flex flex-col gap-1" aria-label="Meses anteriores">
      <div className="card-title">Meses anteriores</div>
      {hist.data.slice(0, 6).map((h) => (
        <button
          key={h.month}
          onClick={() => setMonth(h.month)}
          className="flex min-h-12 cursor-pointer items-center justify-between border-0 border-t border-solid border-border bg-transparent px-0 text-left text-[15px] text-foreground"
        >
          <span>{monthLong(h.month)}</span>
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
            {h.bought} de {h.total} comprados
            <Icon icon="chevron-right" size={14} />
          </span>
        </button>
      ))}
      {month && <CopySheet month={month} disabled={disabled} onClose={() => setMonth(null)} onCopied={onCopied} onError={onError} />}
    </section>
  );
}

function CopySheet({ month, disabled, onClose, onCopied, onError }: { month: string; disabled: boolean; onClose: () => void; onCopied: (l: ShoppingList) => void; onError: (e: unknown) => void }) {
  const closed = useQuery({ queryKey: ['shopping', 'closed', month], queryFn: () => api.closedShoppingList(month) });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const copy = useMutation({ mutationFn: () => api.copyShopping(month, [...chosen]), onSuccess: (l) => (onCopied(l), onClose()), onError });
  let body: ReactNode;
  if (closed.isPending) body = <div className="text-sm text-muted-foreground">Carregando…</div>;
  else if (!closed.data) body = <div className="text-sm text-muted-foreground">Não conseguimos abrir esta lista.</div>;
  else
    body = (
      <div className="flex max-h-[45vh] flex-col overflow-y-auto">
        {closed.data.entries.map((e) => (
          <label key={e.itemId} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={chosen.has(e.itemId)}
              onChange={() => setChosen((s) => (s.has(e.itemId) ? new Set([...s].filter((x) => x !== e.itemId)) : new Set([...s, e.itemId])))}
              className="size-5 accent-brand"
            />
            <span className="flex-1">{e.name}</span>
            <span className="text-xs text-muted-foreground">{e.bought ? 'comprado' : 'não comprado'}</span>
          </label>
        ))}
      </div>
    );
  return (
    <Sheet
      onClose={onClose}
      label={`Lista de ${monthLong(month)}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen.size && !disabled) copy.mutate();
      }}
    >
      <div className="text-lg font-semibold">Lista de {monthLong(month).toLowerCase()}</div>
      <div className="text-sm text-muted-foreground">Listas fechadas não mudam. Escolha o que copiar para este mês.</div>
      {body}
      <SheetActions busy={copy.isPending} primary={chosen.size ? `Copiar ${chosen.size}` : 'Copiar'} secondary="Fechar" />
    </Sheet>
  );
}

/** Esqueleto com o formato final (nunca spinner de tela inteira). */
function Skeleton() {
  const bar = (w: string, h = 14) => <div className="animate-pulse rounded-md bg-muted" style={{ width: w, height: h }} />;
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando lista">
      <div className="card flex flex-col gap-3">
        {bar('50%', 24)}
        {bar('100%', 8)}
        {bar('30%')}
      </div>
      <div className="card flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-6 animate-pulse rounded-md bg-muted" />
            {bar('55%')}
          </div>
        ))}
      </div>
    </div>
  );
}
