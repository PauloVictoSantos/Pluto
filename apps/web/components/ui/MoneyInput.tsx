'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { VALUE_MASK, maskMoney, valuesAreHidden } from '@/lib/format';

/**
 * Campo de dinheiro. Com "ocultar valores" ligado mostra R$ •••• ate receber o foco; o valor
 * digitado continua no estado do formulario (so a exibicao muda).
 */
export function MoneyInput({ value, onChange, ...rest }: { value: string; onChange: (m: ReturnType<typeof maskMoney>) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [focused, setFocused] = useState(false);
  const masked = valuesAreHidden() && !focused && !!value;
  return (
    <input
      {...rest}
      value={masked ? VALUE_MASK : value}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      onChange={(e) => !masked && onChange(maskMoney(e.target.value))}
      inputMode="numeric"
      placeholder={rest.placeholder ?? 'R$ 0,00'}
    />
  );
}
