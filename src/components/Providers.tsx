'use client';

import { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { EnrichmentQueueProvider } from '@/contexts/EnrichmentQueueContext';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <EnrichmentQueueProvider>
        {children}
      </EnrichmentQueueProvider>
    </ToastProvider>
  );
}
