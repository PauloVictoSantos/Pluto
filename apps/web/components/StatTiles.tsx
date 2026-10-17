export interface Tile {
  label: string;
  value: string;
  bg: string;
  fg: string;
  border: string;
}

/** Tres blocos de resumo no topo de Transacoes e Contas. */
export function StatTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {tiles.map((t) => (
        <div
          key={t.label}
          data-anim=""
          className="flex min-w-0 flex-col gap-1.5 rounded-2xl p-[clamp(12px,3vw,20px)]"
          style={{ background: t.bg, color: t.fg, border: `1px solid ${t.border}` }}
        >
          <span className="text-[13px] font-medium">{t.label}</span>
          <span className="truncate text-[clamp(15px,4vw,24px)] font-bold tracking-[-0.03em] whitespace-nowrap tabular-nums">{t.value}</span>
        </div>
      ))}
    </div>
  );
}

export const tileBrand = { bg: '#7D39EB', fg: '#fff', border: '#7D39EB' };
export const tilePlain = { bg: 'var(--card)', fg: 'var(--foreground)', border: 'var(--border)' };
