'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';

export type EnrichmentItemType = 'property' | 'contact' | 'organization' | 'contact_phone' | 'contact_email';
export type EnrichmentStatus = 'pending' | 'processing' | 'polling' | 'completed' | 'failed';

export interface PollConfig {
  checkEndpoint: string;
  checkField: string;
  maxAttempts: number;
  intervalMs: number;
  originalValue?: unknown;
  compareMode: 'truthy' | 'changed' | 'valid_status';
  currentAttempt: number;
}

export interface EnrichmentQueueItem {
  id: string;
  type: EnrichmentItemType;
  entityId: string;
  entityName: string;
  status: EnrichmentStatus;
  progress: number;
  message: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
  resultUrl?: string;
  pollConfig?: PollConfig;
}

interface EnrichmentQueueContextType {
  items: EnrichmentQueueItem[];
  activeCount: number;
  addToQueue: (item: Omit<EnrichmentQueueItem, 'id' | 'createdAt' | 'status' | 'progress' | 'message'>) => string;
  updateItem: (id: string, updates: Partial<EnrichmentQueueItem>) => void;
  markCompleted: (id: string, resultUrl?: string) => void;
  markFailed: (id: string, error: string) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
  startPolling: (id: string, config: Omit<PollConfig, 'currentAttempt'>) => void;
}

const EnrichmentQueueContext = createContext<EnrichmentQueueContextType | undefined>(undefined);

const STORAGE_KEY = 'greenfinch_enrichment_queue';
const MAX_ITEMS = 20;
const EXPIRY_HOURS = 24;

function generateId(): string {
  return `eq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function cleanExpiredItems(items: EnrichmentQueueItem[]): EnrichmentQueueItem[] {
  const expiryTime = Date.now() - (EXPIRY_HOURS * 60 * 60 * 1000);
  return items.filter(item => item.createdAt > expiryTime);
}

function limitItems(items: EnrichmentQueueItem[]): EnrichmentQueueItem[] {
  return items.slice(0, MAX_ITEMS);
}

export function EnrichmentQueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<EnrichmentQueueItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const { toast } = useToast();
  const pollingIntervals = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as EnrichmentQueueItem[];
        const cleaned = cleanExpiredItems(parsed);
        // Reset polling items to failed on reload (they'll need to be retried)
        const processingReset = cleaned.map(item => 
          (item.status === 'processing' || item.status === 'polling') 
            ? { ...item, status: 'failed' as const, error: 'Interrupted - page was refreshed', pollConfig: undefined } 
            : item
        );
        setItems(limitItems(processingReset));
      }
    } catch (e) {
      console.error('Failed to load enrichment queue from storage:', e);
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      try {
        // Don't persist pollConfig to storage (it's runtime-only)
        const itemsToStore = items.map(({ pollConfig, ...rest }) => rest);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(itemsToStore));
      } catch (e) {
        console.error('Failed to save enrichment queue to storage:', e);
      }
    }
  }, [items, isHydrated]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      pollingIntervals.current.forEach(interval => clearInterval(interval));
    };
  }, []);

  const markCompletedInternal = useCallback((id: string, resultUrl?: string, entityName?: string) => {
    // Clear any polling interval
    const interval = pollingIntervals.current.get(id);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.current.delete(id);
    }
    
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      const name = entityName || item?.entityName || 'Item';
      toast({
        title: 'Enrichment Complete',
        description: `${name} has been enriched successfully.`,
      });
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'completed' as const, progress: 100, message: 'Enrichment complete', completedAt: Date.now(), resultUrl, pollConfig: undefined }
          : i
      );
    });
  }, [toast]);

  const markFailedInternal = useCallback((id: string, error: string, entityName?: string) => {
    // Clear any polling interval
    const interval = pollingIntervals.current.get(id);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.current.delete(id);
    }
    
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      const name = entityName || item?.entityName || 'Item';
      toast({
        title: 'Enrichment Failed',
        description: `Failed to enrich ${name}: ${error}`,
        variant: 'destructive',
      });
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'failed' as const, error, message: 'Enrichment failed', completedAt: Date.now(), pollConfig: undefined }
          : i
      );
    });
  }, [toast]);

  const addToQueue = useCallback((item: Omit<EnrichmentQueueItem, 'id' | 'createdAt' | 'status' | 'progress' | 'message'>): string => {
    const id = generateId();
    const newItem: EnrichmentQueueItem = {
      ...item,
      id,
      status: 'pending',
      progress: 0,
      message: 'Queued for enrichment...',
      createdAt: Date.now(),
    };
    
    setItems(prev => {
      const cleaned = cleanExpiredItems(prev);
      return limitItems([newItem, ...cleaned]);
    });
    
    return id;
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<EnrichmentQueueItem>) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  }, []);

  const markCompleted = useCallback((id: string, resultUrl?: string) => {
    markCompletedInternal(id, resultUrl);
  }, [markCompletedInternal]);

  const markFailed = useCallback((id: string, error: string) => {
    markFailedInternal(id, error);
  }, [markFailedInternal]);

  const removeItem = useCallback((id: string) => {
    // Clear any polling interval
    const interval = pollingIntervals.current.get(id);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.current.delete(id);
    }
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setItems(prev => prev.filter(item => item.status !== 'completed' && item.status !== 'failed'));
  }, []);

  const startPolling = useCallback((id: string, config: Omit<PollConfig, 'currentAttempt'>) => {
    const pollConfig: PollConfig = { ...config, currentAttempt: 0 };
    
    // Update item to polling status
    setItems(prev => prev.map(item => 
      item.id === id 
        ? { ...item, status: 'polling' as const, pollConfig, message: 'Waiting for results...', progress: 50 }
        : item
    ));

    // Start polling interval
    const interval = setInterval(async () => {
      // Get current item state
      let currentItem: EnrichmentQueueItem | undefined;
      setItems(prev => {
        currentItem = prev.find(i => i.id === id);
        return prev;
      });

      if (!currentItem || !currentItem.pollConfig) {
        clearInterval(interval);
        pollingIntervals.current.delete(id);
        return;
      }

      const { checkEndpoint, checkField, maxAttempts, originalValue, compareMode, currentAttempt } = currentItem.pollConfig;
      const newAttempt = currentAttempt + 1;

      if (newAttempt > maxAttempts) {
        clearInterval(interval);
        pollingIntervals.current.delete(id);
        markFailedInternal(id, 'Lookup timed out - results may still arrive. Please refresh the page later.', currentItem.entityName);
        return;
      }

      try {
        const response = await fetch(checkEndpoint);
        if (response.ok) {
          const data = await response.json();
          const fieldValue = checkField.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], data);
          
          let conditionMet = false;
          if (compareMode === 'truthy') {
            conditionMet = Boolean(fieldValue);
          } else if (compareMode === 'changed') {
            conditionMet = fieldValue !== originalValue;
          } else if (compareMode === 'valid_status') {
            conditionMet = fieldValue === 'valid' && fieldValue !== originalValue;
          }

          if (conditionMet) {
            clearInterval(interval);
            pollingIntervals.current.delete(id);
            const resultUrl = currentItem.type === 'property' 
              ? `/property/${currentItem.entityId}` 
              : (currentItem.type === 'contact' || currentItem.type === 'contact_phone' || currentItem.type === 'contact_email')
                ? `/contact/${currentItem.entityId}`
                : `/organization/${currentItem.entityId}`;
            markCompletedInternal(id, resultUrl, currentItem.entityName);
            return;
          }
        }
      } catch {
        // Continue polling on error
      }

      // Update progress
      const pollProgress = 50 + (newAttempt / maxAttempts) * 30;
      setItems(prev => prev.map(item => 
        item.id === id && item.pollConfig
          ? { 
              ...item, 
              pollConfig: { ...item.pollConfig, currentAttempt: newAttempt },
              message: `Waiting for results... (${newAttempt}/${maxAttempts})`,
              progress: Math.min(pollProgress, 80)
            }
          : item
      ));
    }, config.intervalMs);

    pollingIntervals.current.set(id, interval);
  }, [markCompletedInternal, markFailedInternal]);

  const activeCount = items.filter(item => item.status === 'pending' || item.status === 'processing' || item.status === 'polling').length;

  return (
    <EnrichmentQueueContext.Provider value={{
      items,
      activeCount,
      addToQueue,
      updateItem,
      markCompleted,
      markFailed,
      removeItem,
      clearCompleted,
      startPolling,
    }}>
      {children}
    </EnrichmentQueueContext.Provider>
  );
}

export function useEnrichmentQueue() {
  const context = useContext(EnrichmentQueueContext);
  if (context === undefined) {
    throw new Error('useEnrichmentQueue must be used within an EnrichmentQueueProvider');
  }
  return context;
}
