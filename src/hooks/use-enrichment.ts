'use client';

import { useCallback } from 'react';
import { useEnrichmentQueue, EnrichmentItemType } from '@/contexts/EnrichmentQueueContext';
import { useToast } from '@/hooks/use-toast';

interface EnrichmentOptions {
  type: EnrichmentItemType;
  entityId: string;
  entityName: string;
  apiEndpoint: string;
  requestBody?: Record<string, unknown>;
  onSuccess?: (data: unknown) => void;
  onError?: (error: string) => void;
  pollForCompletion?: {
    checkEndpoint: string;
    checkField: string;
    maxAttempts?: number;
    intervalMs?: number;
    originalValue?: unknown;
    compareMode?: 'truthy' | 'changed' | 'valid_status';
  };
}

const PROGRESS_MESSAGES: Record<EnrichmentItemType, string[]> = {
  organization: [
    'Greenfinch is researching company...',
    'Searching industry databases...',
    'Gathering social profiles...',
    'Validating company details...',
    'Completing research...',
  ],
  contact: [
    'Greenfinch is verifying email...',
    'Searching LinkedIn profiles...',
    'Cross-referencing data sources...',
    'Verifying contact details...',
    'Completing research...',
  ],
  property: [
    'Greenfinch is researching property...',
    'Identifying decision makers...',
    'Finding contact information...',
    'Validating emails...',
    'Building your contact list...',
  ],
  contact_phone: [
    'Greenfinch is finding phone number...',
    'Searching provider databases...',
    'Verifying phone numbers...',
    'Waiting for results...',
    'Completing phone lookup...',
  ],
  contact_email: [
    'Greenfinch is finding email...',
    'Searching provider databases...',
    'Validating email addresses...',
    'Waiting for results...',
    'Completing email lookup...',
  ],
};

export function useEnrichment() {
  const { addToQueue, updateItem, markCompleted, markFailed, startPolling } = useEnrichmentQueue();
  const { toast } = useToast();

  const startEnrichment = useCallback(async (options: EnrichmentOptions) => {
    const { type, entityId, entityName, apiEndpoint, requestBody, onSuccess, onError, pollForCompletion } = options;
    
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
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        clearInterval(progressInterval);
        if (response.redirected || response.status === 307) {
          throw new Error('Session expired - please refresh the page');
        }
        throw new Error('Server returned an invalid response');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        clearInterval(progressInterval);
        
        // Handle rate limit (429) errors specially
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
          
          // Mark as failed but indicate it's a rate limit
          const rateLimitMessage = `Rate limit reached. Please wait ${retrySeconds} seconds before trying again.`;
          markFailed(queueId, rateLimitMessage);
          
          // Show a user-friendly toast notification for rate limit
          toast({
            title: 'Rate Limit Exceeded',
            description: `You've hit the rate limit for enrichment requests. Please wait about ${retrySeconds} seconds before trying again. This helps ensure fair access for all users.`,
            variant: 'destructive',
          });
          
          onError?.(rateLimitMessage);
          return { success: false, error: rateLimitMessage, rateLimited: true, retryAfter: retrySeconds };
        }
        
        throw new Error(data.error || 'Research failed');
      }

      clearInterval(progressInterval);

      // If polling is needed, start background polling via context
      if (pollForCompletion) {
        const { 
          checkEndpoint, 
          checkField, 
          maxAttempts = 20, 
          intervalMs = 3000,
          originalValue,
          compareMode = 'truthy'
        } = pollForCompletion;
        
        // Start polling in the context (runs in background even if component unmounts)
        startPolling(queueId, {
          checkEndpoint,
          checkField,
          maxAttempts,
          intervalMs,
          originalValue,
          compareMode,
        });
        
        // Call onSuccess immediately since the API call succeeded
        // The polling will handle the final completion
        onSuccess?.(data);
      } else {
        // No polling needed, complete immediately
        const resultUrl = type === 'property' 
          ? `/property/${entityId}` 
          : (type === 'contact' || type === 'contact_phone' || type === 'contact_email')
            ? `/contact/${entityId}`
            : `/organization/${entityId}`;
        
        markCompleted(queueId, resultUrl);
        onSuccess?.(data);
      }
      
      return { success: true, data };
    } catch (err) {
      clearInterval(progressInterval);
      const errorMessage = err instanceof Error ? err.message : 'Research failed';
      markFailed(queueId, errorMessage);
      onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [addToQueue, updateItem, markCompleted, markFailed, startPolling, toast]);

  return { startEnrichment };
}
