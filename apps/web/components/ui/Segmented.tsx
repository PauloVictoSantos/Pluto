import type { ReactNode } from 'react';

interface Item<T extends string> {
  id: T;
  label: ReactNode;
}

/** Grupo de pilulas do design (fundo muted, item ativo em primary). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  height = 36,
  className = '',
  itemClassName = 'px-3.5 text-[13px] font-semibold',
  idleColor = 'var(--muted-foreground)',
}: {
  items: Item<T>[];
  value: T;
  onChange: (id: T) => void;
  height?: number;
  className?: string;
  itemClassName?: string;
  idleColor?: string;
}) {
  return (
    <div className={`no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1 ${className}`}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border-0 ${itemClassName}`}
            style={{ height, background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--primary-foreground)' : idleColor }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
