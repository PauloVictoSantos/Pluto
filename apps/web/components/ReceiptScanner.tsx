'use client';

import type { ReceiptDraft } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { MoneyInput } from './ui/MoneyInput';
import { Sheet, useSheetClose } from './ui/Sheet';

// Scanner de cupom (doc. Melhorias, passo 10). Camera (celular) ou arquivo (computador). Primeiro o
// QR Code da NFC-e, lido no proprio aparelho; sem QR legivel, a foto vai para a IA. A foto nunca e
// gravada: so os dados que voce confere e confirma.

type Barcode = { rawValue: string };
type Detector = { detect(src: ImageBitmap): Promise<Barcode[]> };
const detectorCtor = () => (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;

/** QR do cupom lido no aparelho (BarcodeDetector); null se o navegador nao suporta ou nao achou. */
async function readQr(file: Blob): Promise<string | null> {
  const Ctor = detectorCtor();
  if (!Ctor) return null;
  try {
    const bmp = await createImageBitmap(file);
    const codes = await new Ctor({ formats: ['qr_code'] }).detect(bmp);
    return codes.find((c) => /nfce|sefaz|fazenda|\d{44}/i.test(c.rawValue))?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Reduz a foto para ate 1600 px e JPEG (cabe no envio e a IA le bem). */
async function compress(file: Blob): Promise<{ mimeType: 'image/jpeg'; base64: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const q of [0.8, 0.65, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', q);
    const base64 = url.slice(url.indexOf(',') + 1);
    if (base64.length < 3_500_000) return { mimeType: 'image/jpeg', base64 };
  }
  throw new ApiRequestError(413, 'IMAGE_TOO_BIG', 'A foto ficou grande demais. Tente de novo mais perto do cupom.');
}

export function ReceiptScanner() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-outline h-10 self-start px-4 text-[14px]">
        <Icon icon="barcode" size={16} />
        Escanear cupom
      </button>
      {open && <ScannerSheet onClose={() => setOpen(false)} />}
    </>
  );
}

type Row = { name: string; qty: string; total: ReturnType<typeof maskMoney> };

function ScannerSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'pick' | 'reading' | 'review' | 'done'>('pick');
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<{ checkedOff: string[]; linked: boolean } | null>(null);

  const toReview = (d: ReceiptDraft) => {
    setDraft(d);
    setRows(d.items.map((i) => ({ name: i.name, qty: String(i.qty).replace('.', ','), total: maskMoney(String(i.totalMinor)) })));
    setStep('review');
  };
  const scan = async (body: Parameters<typeof api.scanReceipt>[0]) => {
    setError('');
    setStep('reading');
    try {
      toReview(await api.scanReceipt(body));
    } catch (e) {
      setStep('pick');
      setError(e instanceof ApiRequestError ? e.message : 'Não consegui ler o cupom agora. Tente de novo.');
    }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const qr = await readQr(file);
    if (qr) return scan({ qr });
    try {
      await scan({ image: await compress(file) });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Não consegui abrir a foto.');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const items = rows
    .map((r) => {
      const qty = Number(r.qty.replace(',', '.')) || 1;
      const totalMinor = Math.round(r.total.value * 100);
      return { name: r.name.trim(), qty, totalMinor, unitPriceMinor: Math.round(totalMinor / qty) };
    })
    .filter((i) => i.name && i.totalMinor > 0);
  const sum = items.reduce((t, i) => t + i.totalMinor, 0);
  const save = useMutation({
    mutationFn: () => api.saveReceipt({ ...draft!, items, totalMinor: sum }),
    onSuccess: (r) => {
      setResult({ checkedOff: r.checkedOff, linked: !!r.transactionId });
      setStep('done');
      for (const k of ['shopping', 'shopping-insights', 'transactions', 'dashboard', 'spending']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar.'),
  });

  return (
    <Sheet onClose={onClose} label="Escanear cupom" width={520} top="5vh" gap={12} closeButton>
      <div className="pr-10 text-xl font-bold tracking-[-0.02em]">{step === 'review' ? 'Confira os itens' : step === 'done' ? 'Cupom salvo' : 'Escanear cupom'}</div>

      {(step === 'pick' || step === 'reading') && (
        <>
          <p className="m-0 text-[14px] text-pretty text-muted-foreground">
            Fotografe o cupom inteiro. Se o QR Code aparecer, a Pluto busca os itens oficiais na SEFAZ; senão, lê a foto. A foto não é guardada: só os dados que você confirmar.
          </p>
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button onClick={() => input.current?.click()} disabled={step === 'reading'} className="btn btn-primary h-12">
            <Icon icon="barcode" size={18} />
            {step === 'reading' ? 'Lendo o cupom…' : 'Tirar foto ou escolher imagem'}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void scan({ qr: link.trim() });
            }}
            className="flex gap-2"
          >
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Ou cole o link do QR Code / a chave de 44 dígitos" aria-label="Link do QR Code" className="input h-11 min-w-0 flex-1 text-[14px]" />
            <button type="submit" disabled={!link.trim() || step === 'reading'} className="btn btn-outline h-11 px-3 text-[14px]">
              Ler
            </button>
          </form>
        </>
      )}

      {step === 'review' && draft && (
        <>
          <div className="text-[13px] text-muted-foreground">
            {[draft.store, draft.date?.split('-').reverse().join('/'), draft.source === 'sefaz' ? 'itens oficiais da SEFAZ' : 'lido da foto: confira com atenção'].filter(Boolean).join(' · ')}
          </div>
          <div className="flex flex-col">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 border-t border-border py-2">
                <input value={r.name} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 80) } : x)))} aria-label="Item" className="input h-10 min-w-0 flex-1 basis-full text-[14px] sm:basis-0" />
                <input value={r.qty} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^\d,.]/g, '').slice(0, 7) } : x)))} aria-label="Quantidade" inputMode="decimal" className="input h-10 w-16 text-center text-[14px]" />
                <span className="flex-1 sm:hidden" />
                <MoneyInput value={r.total.text} onChange={(m) => setRows((all) => all.map((x, j) => (j === i ? { ...x, total: m } : x)))} aria-label="Total do item" className="input h-10 w-[110px] text-right text-[14px]" />
                <button type="button" onClick={() => setRows((all) => all.filter((_, j) => j !== i))} aria-label={`Remover ${r.name}`} className="icon-btn size-9 shrink-0">
                  <Icon icon="x" size={15} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setRows((all) => [...all, { name: '', qty: '1', total: maskMoney('') }])} className="flex h-9 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
            <Icon icon="plus" size={14} />
            Adicionar item
          </button>
          <div className="flex justify-between rounded-xl bg-muted px-3 py-2.5 text-[14px]">
            <span>Total ({items.length} itens)</span>
            <span className="font-bold tabular-nums">{money(sum)}</span>
          </div>
          {draft.totalMinor && Math.abs(draft.totalMinor - sum) > 1 ? (
            <div className="text-[12.5px] text-muted-foreground">O cupom diz {money(draft.totalMinor)}. A diferença costuma ser desconto ou item que não foi lido.</div>
          ) : null}
        </>
      )}

      {step === 'done' && result && (
        <div className="flex flex-col gap-2 text-[14px]">
          <div className="flex items-center gap-2 font-semibold text-brand-text">
            <Icon icon="circle-check" size={18} />
            Pronto. Só os dados foram salvos.
          </div>
          <div>{result.checkedOff.length ? `Riscados da lista: ${result.checkedOff.join(', ')}.` : 'Nenhum item da lista estava neste cupom.'}</div>
          <div className="text-muted-foreground">
            {result.linked ? 'A compra do banco ficou em Mercado, ligada a este cupom.' : 'Quando a compra aparecer no banco, a Pluto liga ao cupom e coloca em Mercado.'}
          </div>
        </div>
      )}

      {error && (
        <div role="status" className="rounded-xl bg-muted px-3 py-2.5 text-[13px]">
          {error}
        </div>
      )}

      {(step === 'review' || step === 'done') && (
        <div className="sticky -bottom-[calc(24px+env(safe-area-inset-bottom))] -mx-5 -mb-[calc(24px+env(safe-area-inset-bottom))] flex gap-2 border-t border-border bg-card px-5 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
          {step === 'review' ? (
            <>
              <button type="button" onClick={() => setStep('pick')} className="btn btn-outline h-11 flex-1">
                Ler outro
              </button>
              <button type="button" onClick={() => save.mutate()} disabled={!items.length || save.isPending} className="btn btn-primary h-11 flex-1 disabled:opacity-50">
                {save.isPending ? 'Salvando…' : 'Confirmar e salvar'}
              </button>
            </>
          ) : (
            <CloseButton />
          )}
        </div>
      )}
    </Sheet>
  );
}

function CloseButton() {
  const close = useSheetClose();
  return (
    <button type="button" onClick={close} className="btn btn-primary h-11 flex-1">
      Fechar
    </button>
  );
}
