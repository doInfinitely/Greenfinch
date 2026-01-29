'use client';

import { useCallback } from 'react';
import { useEnrichmentQueue, EnrichmentItemType } from '@/contexts/EnrichmentQueueContext';

interface EnrichmentOptions {
  type: EnrichmentItemType;
  entityId: string;
  entityName: string;
  apiEndpoint: string;
  requestBody?: Record<string, unknown>;
  onSuccess?: (data: unknown) => void;
  onError?: (error: string) => void;
}

const PROGRESS_MESSAGES: Record<EnrichmentItemType, string[]> = {
  organization: [
    'Looking up company information...',
    'Searching industry databases...',
    'Gathering social profiles...',
    'Validating company details...',
    'Finalizing enrichment...',
  ],
  contact: [
    'Validating email address...',
    'Searching LinkedIn profiles...',
    'Cross-referencing data sources...',
    'Verifying contact details...',
    'Completing enrichment...',
  ],
  property: [
    'Researching property ownership...',
    'Identifying decision makers...',
    'Finding contact information...',
    'Validating emails...',
    'Building your contact list...',
  ],
};

export function useEnrichment() {
  const { addToQueue, updateItem, markCompleted, markFailed } = useEnrichmentQueue();

  const startEnrichment = useCallback(async (options: EnrichmentOptions) => {
    const { type, entityId, entityName, apiEndpoint, requestBody, onSuccess, onError } = options;
    
    const queueId = addToQueue({
      type,
      entityId,
      entityName,
    });

    updateItem(queueId, { status: 'processing', message: PROGRESS_MESSAGES[type][0], progress: 10 });

    let messageIndex = 0;
    const messages = PROGRESS_MESSAGES[type];
    
    const progressInterval = setInterval(() => {
      messageIndex = Math.min(messageIndex + 1, messages.length - 1);
      const progress = ((messageIndex + 1) / messages.length) * 80;
      updateItem(queueId, {
        message: messages[messageIndex],
        progress,
      });
    }, 3000);

    try {
      const fetchOptions: RequestInit = { method: 'POST' };
      if (requestBody) {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(requestBody);
      }
      const response = await fetch(apiEndpoint, fetchOptions);
      
      clearInterval(progressInterval);
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        if (response.redirected || response.status === 307) {
          throw new Error('Session expired - please refresh the page');
        }
        throw new Error('Server returned an invalid response');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Enrichment failed');
      }
      
      const resultUrl = type === 'property' 
        ? `/property/${entityId}` 
        : type === 'contact'
          ? `/contact/${entityId}`
          : `/organization/${entityId}`;
      
      markCompleted(queueId, resultUrl);
      onSuccess?.(data);
      
      return { success: true, data };
    } catch (err) {
      clearInterval(progressInterval);
      const errorMessage = err instanceof Error ? err.message : 'Enrichment failed';
      markFailed(queueId, errorMessage);
      onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [addToQueue, updateItem, markCompleted, markFailed]);

  return { startEnrichment };
}
