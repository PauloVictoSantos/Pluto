'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { ConnectingOverlay } from '@/components/shell/ConnectingOverlay';
import { queryClient } from '@/lib/query-client';
import { hydrate } from '@/lib/store';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => void hydrate(), []);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ConnectingOverlay />
    </QueryClientProvider>
  );
}
