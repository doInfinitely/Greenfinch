'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';

export type EnrichmentItemType = 'property' | 'contact' | 'organization';
export type EnrichmentStatus = 'pending' | 'processing' | 'completed' | 'failed';

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

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as EnrichmentQueueItem[];
        const cleaned = cleanExpiredItems(parsed);
        const processingReset = cleaned.map(item => 
          item.status === 'processing' ? { ...item, status: 'failed' as const, error: 'Interrupted' } : item
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch (e) {
        console.error('Failed to save enrichment queue to storage:', e);
      }
    }
  }, [items, isHydrated]);

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
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        toast({
          title: 'Enrichment Complete',
          description: `${item.entityName} has been enriched successfully.`,
        });
      }
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'completed' as const, progress: 100, message: 'Enrichment complete', completedAt: Date.now(), resultUrl }
          : i
      );
    });
  }, [toast]);

  const markFailed = useCallback((id: string, error: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        toast({
          title: 'Enrichment Failed',
          description: `Failed to enrich ${item.entityName}: ${error}`,
          variant: 'destructive',
        });
      }
      return prev.map(i => 
        i.id === id 
          ? { ...i, status: 'failed' as const, error, message: 'Enrichment failed', completedAt: Date.now() }
          : i
      );
    });
  }, [toast]);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setItems(prev => prev.filter(item => item.status !== 'completed' && item.status !== 'failed'));
  }, []);

  const activeCount = items.filter(item => item.status === 'pending' || item.status === 'processing').length;

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
