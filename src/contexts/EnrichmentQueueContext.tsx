'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export type EnrichmentItemType = 'property' | 'contact' | 'organization' | 'contact_phone' | 'contact_email';
export type EnrichmentStatus = 'pending' | 'processing' | 'polling' | 'completed' | 'failed';

const BROADCAST_CHANNEL_NAME = 'greenfinch_enrichment_queue';

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
  getEnrichmentStatus: (entityId: string, type?: EnrichmentItemType) => { 
    isActive: boolean; 
    status: EnrichmentStatus | null; 
    error?: string;
  };
}

const EnrichmentQueueContext = createContext<EnrichmentQueueContextType | undefined>(undefined);

const STORAGE_KEY = 'greenfinch_enrichment_queue';
const SESSION_KEY = 'greenfinch_enrichment_session';
const MAX_ITEMS = 20;
const EXPIRY_HOURS = 24;

function generateId(): string {
  return `eq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  const queryClient = useQueryClient();
  const pollingIntervals = useRef<Map<string, NodeJS.Timeout>>(new Map());
  // Track which items have already fired completion to prevent duplicate toasts (race condition guard)
  const completedItemsRef = useRef<Set<string>>(new Set());
  // BroadcastChannel for cross-tab sync
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  // Track if current update is from local actions (should broadcast) vs received from another tab
  const isLocalUpdate = useRef(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as EnrichmentQueueItem[];
        const cleaned = cleanExpiredItems(parsed);
        
        // Check if we're in the same browser session
        // sessionStorage persists during navigation but clears on tab close/refresh
        const currentSessionId = sessionStorage.getItem(SESSION_KEY);
        const isNewSession = !currentSessionId;
        
        if (isNewSession) {
          // New session (page refresh or new tab) - mark processing items as failed
          const processingReset = cleaned.map(item => 
            (item.status === 'processing' || item.status === 'polling') 
              ? { ...item, status: 'failed' as const, error: 'Interrupted - page was refreshed', pollConfig: undefined } 
              : item
          );
          setItems(limitItems(processingReset));
          // Set session ID for this session
          sessionStorage.setItem(SESSION_KEY, generateSessionId());
        } else {
          // Same session (navigation within app) - keep items as-is
          // Note: pollConfig is not persisted, so polling won't auto-resume
          // but we don't mark them as failed since they may still be processing on the server
          setItems(limitItems(cleaned));
        }
      } else {
        // No stored items - ensure session ID is set
        sessionStorage.setItem(SESSION_KEY, generateSessionId());
      }
    } catch (e) {
      console.error('Failed to load enrichment queue from storage:', e);
    }
    setIsHydrated(true);
  }, []);

  // Initialize BroadcastChannel for cross-tab sync
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
      return;
    }
    
    try {
      broadcastChannelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data?.type === 'QUEUE_UPDATE') {
          console.log('[EnrichmentQueue] Received cross-tab update');
          isLocalUpdate.current = false;
          const newItems = event.data.items as EnrichmentQueueItem[];
          setItems(newItems);
        }
      };
      
      console.log('[EnrichmentQueue] BroadcastChannel initialized for cross-tab sync');
    } catch (e) {
      console.warn('[EnrichmentQueue] Failed to create BroadcastChannel:', e);
    }
    
    return () => {
      broadcastChannelRef.current?.close();
      broadcastChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isHydrated) {
      try {
        // Persist items including pollConfig for session continuity
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        
        // Broadcast to other tabs (only if this was a local update, not a received message)
        if (isLocalUpdate.current && broadcastChannelRef.current) {
          broadcastChannelRef.current.postMessage({
            type: 'QUEUE_UPDATE',
            items: items,
          });
        }
        // Reset flag for next update
        isLocalUpdate.current = true;
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
    // Synchronous guard using ref to prevent race condition between multiple polling callbacks
    if (completedItemsRef.current.has(id)) {
      console.log(`[EnrichmentQueue] Item ${id} already completed (ref guard), skipping duplicate`);
      return;
    }
    completedItemsRef.current.add(id);
    
    // Clear any polling interval
    const interval = pollingIntervals.current.get(id);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.current.delete(id);
    }
    
    // Get current item info for toast BEFORE updating state
    let shouldShowToast = false;
    let toastName = entityName || 'Item';
    
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      
      // Secondary guard - if already completed, don't show toast
      if (item?.status === 'completed') {
        console.log(`[EnrichmentQueue] Item ${id} already completed (state guard), skipping duplicate toast`);
        return prev;
      }
      
      // Mark that we should show toast (will be shown after state update)
      shouldShowToast = true;
      toastName = entityName || item?.entityName || 'Item';
      
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'completed' as const, progress: 100, message: 'Research complete', completedAt: Date.now(), resultUrl, pollConfig: undefined }
          : i
      );
    });
    
    // Show toast OUTSIDE of setItems to avoid React batching issues
    if (shouldShowToast) {
      toast({
        title: 'Research Complete',
        description: `Greenfinch has finished researching ${toastName}.`,
      });
      
      // Invalidate queries to refresh contact/property lists immediately
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      
      // Dispatch custom event for pages that don't use React Query
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('enrichment-complete', { detail: { type: 'success' } }));
      }
    }
  }, [toast, queryClient]);

  const markFailedInternal = useCallback((id: string, error: string, entityName?: string) => {
    // Synchronous guard using ref to prevent race condition (reuse completedItemsRef for terminal states)
    if (completedItemsRef.current.has(id)) {
      console.log(`[EnrichmentQueue] Item ${id} already terminated (ref guard), skipping duplicate failure`);
      return;
    }
    completedItemsRef.current.add(id);
    
    // Clear any polling interval
    const interval = pollingIntervals.current.get(id);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.current.delete(id);
    }
    
    let shouldShowToast = false;
    let toastName = entityName || 'Item';
    
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      
      // Secondary guard - if already failed/completed, don't show toast
      if (item?.status === 'failed' || item?.status === 'completed') {
        console.log(`[EnrichmentQueue] Item ${id} already terminated (state guard), skipping duplicate toast`);
        return prev;
      }
      
      shouldShowToast = true;
      toastName = entityName || item?.entityName || 'Item';
      
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'failed' as const, error, message: 'Research failed', completedAt: Date.now(), pollConfig: undefined }
          : i
      );
    });
    
    // Show toast OUTSIDE of setItems to avoid React batching issues
    if (shouldShowToast) {
      // Use friendlier messaging for common error types
      const isEmailNotFound = error.toLowerCase().includes('no match') || 
                              error.toLowerCase().includes('not found') ||
                              error.toLowerCase().includes('no email');
      
      toast({
        title: isEmailNotFound ? 'No Results Found' : 'Research Issue',
        description: isEmailNotFound 
          ? `We weren't able to find an email address for ${toastName}.`
          : `We encountered an issue researching ${toastName}. Please try again later.`,
        variant: 'default',
      });
      
      // Still invalidate queries in case partial data was saved
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      
      // Dispatch custom event for pages that don't use React Query
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('enrichment-complete', { detail: { type: 'failed' } }));
      }
    }
  }, [toast, queryClient]);

  // Resume polling for items that have pollConfig (after navigation within same session)
  useEffect(() => {
    if (!isHydrated) return;
    
    // Find items that need polling resumed
    items.forEach(item => {
      if (
        (item.status === 'polling' || item.status === 'processing') && 
        item.pollConfig && 
        !pollingIntervals.current.has(item.id)
      ) {
        console.log('[EnrichmentQueue] Resuming polling for:', item.entityName, item.id);
        
        // Resume the polling interval
        const { checkEndpoint, checkField, intervalMs, maxAttempts, originalValue, compareMode } = item.pollConfig;
        
        const interval = setInterval(async () => {
          let currentItem: EnrichmentQueueItem | undefined;
          setItems(prev => {
            currentItem = prev.find(i => i.id === item.id);
            return prev;
          });

          if (!currentItem || !currentItem.pollConfig) {
            clearInterval(interval);
            pollingIntervals.current.delete(item.id);
            return;
          }

          const newAttempt = currentItem.pollConfig.currentAttempt + 1;

          if (newAttempt > maxAttempts) {
            clearInterval(interval);
            pollingIntervals.current.delete(item.id);
            markFailedInternal(item.id, 'Lookup timed out - results may still arrive. Please refresh the page later.', currentItem.entityName);
            return;
          }

          // Update attempt count and message
          setItems(prev => prev.map(i => 
            i.id === item.id && i.pollConfig
              ? { 
                  ...i, 
                  pollConfig: { ...i.pollConfig!, currentAttempt: newAttempt },
                  message: `Checking for results...`
                }
              : i
          ));

          try {
            console.log(`[EnrichmentQueue] Resume polling ${currentItem?.entityName}: attempt ${newAttempt}, checking ${checkEndpoint}`);
            const response = await fetch(checkEndpoint);
            if (!response.ok) {
              console.warn('[EnrichmentQueue] Poll check failed:', response.status);
              return;
            }

            const data = await response.json();
            let fieldValue = data;
            for (const key of checkField.split('.')) {
              fieldValue = fieldValue?.[key];
            }

            console.log(`[EnrichmentQueue] Resume polling ${currentItem?.entityName}: field=${checkField}, current=${fieldValue}, original=${originalValue}, mode=${compareMode}`);

            let isComplete = false;
            if (compareMode === 'truthy') {
              isComplete = !!fieldValue;
            } else if (compareMode === 'changed') {
              // Convert to strings for consistent comparison (dates can be Date objects or ISO strings)
              const currentStr = fieldValue instanceof Date ? fieldValue.toISOString() : String(fieldValue ?? '');
              const originalStr = originalValue instanceof Date ? (originalValue as Date).toISOString() : String(originalValue ?? '');
              isComplete = currentStr !== originalStr && !!fieldValue;
              console.log(`[EnrichmentQueue] Resume changed comparison: "${currentStr}" !== "${originalStr}" = ${isComplete}`);
            } else if (compareMode === 'valid_status') {
              isComplete = fieldValue === 'valid';
            }

            if (isComplete) {
              console.log(`[EnrichmentQueue] Resume polling complete for ${currentItem?.entityName}!`);
              clearInterval(interval);
              pollingIntervals.current.delete(item.id);
              markCompletedInternal(item.id, currentItem?.resultUrl, currentItem?.entityName);
            }
          } catch (error) {
            console.warn('[EnrichmentQueue] Poll error:', error);
          }
        }, intervalMs);

        pollingIntervals.current.set(item.id, interval);
      }
    });
  }, [isHydrated, items, markFailedInternal, markCompletedInternal]);

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
    const { checkEndpoint, checkField, maxAttempts, originalValue, compareMode, intervalMs } = config;
    
    console.log(`[EnrichmentQueue] Starting polling for item ${id}:`, { 
      checkEndpoint, 
      checkField,
      originalValue,
      compareMode
    });
    
    // Store entity info for use in interval (avoid relying on state inside interval)
    let storedEntityName = '';
    let storedEntityId = '';
    let storedType: EnrichmentItemType = 'contact';
    
    // Update item to polling status and capture entity info
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        storedEntityName = item.entityName;
        storedEntityId = item.entityId;
        storedType = item.type;
      }
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'polling' as const, pollConfig, message: 'Waiting for results...', progress: 50 }
          : i
      );
    });

    let attemptCount = 0;

    // Start polling interval
    const interval = setInterval(async () => {
      attemptCount++;

      if (attemptCount > maxAttempts) {
        console.log(`[EnrichmentQueue] Max attempts (${maxAttempts}) reached for ${storedEntityName}`);
        clearInterval(interval);
        pollingIntervals.current.delete(id);
        markFailedInternal(id, 'Lookup timed out - results may still arrive. Please refresh the page later.', storedEntityName);
        return;
      }

      try {
        console.log(`[EnrichmentQueue] Polling ${storedEntityName}: attempt ${attemptCount}/${maxAttempts}, checking ${checkEndpoint}`);
        const response = await fetch(checkEndpoint);
        if (response.ok) {
          const data = await response.json();
          const fieldValue = checkField.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], data);
          
          console.log(`[EnrichmentQueue] Polling ${storedEntityName}: field=${checkField}, current=${fieldValue}, original=${originalValue}, mode=${compareMode}`);
          
          let conditionMet = false;
          if (compareMode === 'truthy') {
            conditionMet = Boolean(fieldValue);
          } else if (compareMode === 'changed') {
            // Convert to strings for consistent comparison (dates can be Date objects or ISO strings)
            const currentStr = fieldValue instanceof Date ? fieldValue.toISOString() : String(fieldValue ?? '');
            const originalStr = originalValue instanceof Date ? (originalValue as Date).toISOString() : String(originalValue ?? '');
            conditionMet = currentStr !== originalStr && !!fieldValue;
            console.log(`[EnrichmentQueue] Changed comparison: "${currentStr}" !== "${originalStr}" = ${conditionMet}`);
          } else if (compareMode === 'valid_status') {
            conditionMet = fieldValue === 'valid' && fieldValue !== originalValue;
          }

          if (conditionMet) {
            console.log(`[EnrichmentQueue] Polling complete for ${storedEntityName}!`);
            clearInterval(interval);
            pollingIntervals.current.delete(id);
            const resultUrl = storedType === 'property' 
              ? `/property/${storedEntityId}` 
              : (storedType === 'contact' || storedType === 'contact_phone' || storedType === 'contact_email')
                ? `/contact/${storedEntityId}`
                : `/organization/${storedEntityId}`;
            markCompletedInternal(id, resultUrl, storedEntityName);
            return;
          }
        }
      } catch (error) {
        console.warn(`[EnrichmentQueue] Polling error for ${storedEntityName}:`, error);
        // Continue polling on error
      }

      // Update progress in state
      const pollProgress = 50 + (attemptCount / maxAttempts) * 30;
      setItems(prev => prev.map(item => 
        item.id === id && item.pollConfig
          ? { 
              ...item, 
              pollConfig: { ...item.pollConfig, currentAttempt: attemptCount },
              message: `Waiting for results...`,
              progress: Math.min(pollProgress, 80)
            }
          : item
      ));
    }, intervalMs);

    pollingIntervals.current.set(id, interval);
    
    // Do an immediate first poll after a short delay (in case webhook arrived before polling started)
    setTimeout(async () => {
      try {
        console.log(`[EnrichmentQueue] Immediate first poll for ${storedEntityName}`);
        const response = await fetch(checkEndpoint);
        if (response.ok) {
          const data = await response.json();
          const fieldValue = checkField.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], data);
          
          let conditionMet = false;
          if (compareMode === 'changed') {
            const currentStr = fieldValue instanceof Date ? fieldValue.toISOString() : String(fieldValue ?? '');
            const originalStr = originalValue instanceof Date ? (originalValue as Date).toISOString() : String(originalValue ?? '');
            conditionMet = currentStr !== originalStr && !!fieldValue;
            if (conditionMet) {
              console.log(`[EnrichmentQueue] Immediate poll detected completion for ${storedEntityName}!`);
              clearInterval(interval);
              pollingIntervals.current.delete(id);
              const resultUrl = storedType === 'property' 
                ? `/property/${storedEntityId}` 
                : (storedType === 'contact' || storedType === 'contact_phone' || storedType === 'contact_email')
                  ? `/contact/${storedEntityId}`
                  : `/organization/${storedEntityId}`;
              markCompletedInternal(id, resultUrl, storedEntityName);
            }
          }
        }
      } catch (error) {
        console.warn('[EnrichmentQueue] Immediate poll error:', error);
      }
    }, 500);
  }, [markCompletedInternal, markFailedInternal]);

  const activeCount = items.filter(item => item.status === 'pending' || item.status === 'processing' || item.status === 'polling').length;

  const getEnrichmentStatus = useCallback((entityId: string, type?: EnrichmentItemType) => {
    // Find the most recent enrichment for this entity (optionally filtered by type)
    const matchingItems = items.filter(item => 
      item.entityId === entityId && (!type || item.type === type)
    );
    
    if (matchingItems.length === 0) {
      return { isActive: false, status: null };
    }
    
    // Get the most recent item (items are sorted newest first)
    const latestItem = matchingItems[0];
    const isActive = latestItem.status === 'pending' || latestItem.status === 'processing' || latestItem.status === 'polling';
    
    return {
      isActive,
      status: latestItem.status,
      error: latestItem.error,
    };
  }, [items]);

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
      getEnrichmentStatus,
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
