'use client';

import { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EnrichmentQueueProvider } from '@/contexts/EnrichmentQueueContext';
import { CelebrationProvider } from '@/contexts/CelebrationContext';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <CelebrationProvider>
          <EnrichmentQueueProvider>
            {children}
          </EnrichmentQueueProvider>
        </CelebrationProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}
