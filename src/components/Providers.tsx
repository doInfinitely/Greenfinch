'use client';

import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EnrichmentQueueProvider } from '@/contexts/EnrichmentQueueContext';
import { CelebrationProvider } from '@/contexts/CelebrationContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <CelebrationProvider>
            <EnrichmentQueueProvider>
              {children}
            </EnrichmentQueueProvider>
          </CelebrationProvider>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
