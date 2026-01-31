'use client';

import { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { EnrichmentQueueProvider } from '@/contexts/EnrichmentQueueContext';
import { CelebrationProvider } from '@/contexts/CelebrationContext';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <CelebrationProvider>
        <EnrichmentQueueProvider>
          {children}
        </EnrichmentQueueProvider>
      </CelebrationProvider>
    </ToastProvider>
  );
}
