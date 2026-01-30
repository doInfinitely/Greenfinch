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
  contact_phone: [
    'Initiating phone lookup...',
    'Searching provider databases...',
    'Verifying phone numbers...',
    'Waiting for results...',
    'Completing phone lookup...',
  ],
  contact_email: [
    'Initiating email lookup...',
    'Searching provider databases...',
    'Validating email addresses...',
    'Waiting for results...',
    'Completing email lookup...',
  ],
};

export function useEnrichment() {
  const { addToQueue, updateItem, markCompleted, markFailed } = useEnrichmentQueue();

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
        throw new Error(data.error || 'Enrichment failed');
      }

      // If polling for webhook-based completion, wait for the field to be populated
      if (pollForCompletion) {
        const { 
          checkEndpoint, 
          checkField, 
          maxAttempts = 20, 
          intervalMs = 3000,
          originalValue,
          compareMode = 'truthy'
        } = pollForCompletion;
        
        updateItem(queueId, { message: 'Waiting for results...', progress: 50 });
        
        let attempts = 0;
        let completed = false;
        
        while (attempts < maxAttempts && !completed) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          attempts++;
          
          try {
            const checkResponse = await fetch(checkEndpoint);
            if (checkResponse.ok) {
              const checkData = await checkResponse.json();
              const fieldValue = checkField.split('.').reduce((obj: any, key) => obj?.[key], checkData);
              
              // Determine if the condition is met based on compare mode
              let conditionMet = false;
              if (compareMode === 'truthy') {
                conditionMet = Boolean(fieldValue);
              } else if (compareMode === 'changed') {
                conditionMet = fieldValue !== originalValue;
              } else if (compareMode === 'valid_status') {
                // For email validation - check if status is 'valid' and different from original
                conditionMet = fieldValue === 'valid' && fieldValue !== originalValue;
              }
              
              if (conditionMet) {
                completed = true;
                updateItem(queueId, { message: 'Results received!', progress: 90 });
              } else {
                const pollProgress = 50 + (attempts / maxAttempts) * 30;
                updateItem(queueId, { 
                  message: `Waiting for results... (${attempts}/${maxAttempts})`,
                  progress: Math.min(pollProgress, 80)
                });
              }
            }
          } catch {
            // Continue polling on error
          }
        }
        
        clearInterval(progressInterval);
        
        if (!completed) {
          throw new Error('Lookup timed out - results may still arrive. Please refresh the page later.');
        }
      } else {
        clearInterval(progressInterval);
      }
      
      const resultUrl = type === 'property' 
        ? `/property/${entityId}` 
        : (type === 'contact' || type === 'contact_phone' || type === 'contact_email')
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
