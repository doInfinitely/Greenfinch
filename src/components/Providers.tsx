'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOrganization } from '@clerk/nextjs';
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

function OrgSwitchWatcher() {
  const { organization } = useOrganization();
  const prevOrgId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentOrgId = organization?.id;
    if (prevOrgId.current !== undefined && prevOrgId.current !== currentOrgId) {
      queryClient.clear();
    }
    prevOrgId.current = currentOrgId;
  }, [organization?.id]);

  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <CelebrationProvider>
            <EnrichmentQueueProvider>
              <OrgSwitchWatcher />
              {children}
            </EnrichmentQueueProvider>
          </CelebrationProvider>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
