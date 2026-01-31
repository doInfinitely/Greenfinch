'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useEnrichmentQueue, EnrichmentQueueItem } from '@/contexts/EnrichmentQueueContext';
import { useCelebration } from '@/contexts/CelebrationContext';
import { Loader2, CheckCircle, XCircle, ChevronRight, X } from 'lucide-react';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const TYPE_LABELS: Record<string, string> = {
  property: 'Property',
  contact: 'Contact',
  organization: 'Organization',
  contact_phone: 'Phone Lookup',
  contact_email: 'Email Lookup',
};

const TYPE_COLORS: Record<string, string> = {
  property: 'bg-blue-100 text-blue-700',
  contact: 'bg-purple-100 text-purple-700',
  organization: 'bg-amber-100 text-amber-700',
  contact_phone: 'bg-emerald-100 text-emerald-700',
  contact_email: 'bg-teal-100 text-teal-700',
};

function getResultUrl(item: EnrichmentQueueItem): string | undefined {
  if (item.resultUrl) return item.resultUrl;
  if (item.status !== 'completed') return undefined;
  
  switch (item.type) {
    case 'property':
      return `/property/${item.entityId}`;
    case 'contact':
      return `/contact/${item.entityId}`;
    case 'organization':
      return `/organization/${item.entityId}`;
    default:
      return undefined;
  }
}

function QueueItem({ item, onRemove }: { item: EnrichmentQueueItem; onRemove: () => void }) {
  const resultUrl = getResultUrl(item);
  const isActive = item.status === 'pending' || item.status === 'processing' || item.status === 'polling';
  
  const content = (
    <div className={`p-3 border-b border-gray-100 last:border-b-0 ${resultUrl ? 'hover:bg-gray-50 cursor-pointer' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {(item.status === 'processing' || item.status === 'polling') && (
            <Loader2 className="w-4 h-4 text-green-600 animate-spin" />
          )}
          {item.status === 'pending' && (
            <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
          )}
          {item.status === 'completed' && (
            <CheckCircle className="w-4 h-4 text-green-600" />
          )}
          {item.status === 'failed' && (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[item.type]}`}>
              {TYPE_LABELS[item.type]}
            </span>
            <span className="text-sm font-medium text-gray-900 truncate" data-testid={`text-queue-item-name-${item.id}`}>
              {item.entityName}
            </span>
          </div>
          
          <p className="text-xs text-gray-500 mt-1 truncate">
            {item.message}
          </p>
          
          {isActive && item.progress > 0 && (
            <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${Math.min(item.progress, 100)}%` }}
              />
            </div>
          )}
          
          {item.error && (
            <p className="text-xs text-red-500 mt-1 truncate">
              {item.error}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {resultUrl && item.status === 'completed' && (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          {!isActive && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }}
              className="p-1 hover:bg-gray-200 rounded transition-colors"
              data-testid={`button-remove-queue-item-${item.id}`}
            >
              <X className="w-3 h-3 text-gray-400" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
  
  if (resultUrl && item.status === 'completed') {
    return (
      <Link href={resultUrl} data-testid={`link-queue-item-${item.id}`}>
        {content}
      </Link>
    );
  }
  
  return content;
}

export default function EnrichmentQueuePopover() {
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const { items, activeCount, removeItem, clearCompleted } = useEnrichmentQueue();
  const { celebrate, setOriginRef } = useCelebration();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const prevCompletedCountRef = useRef(0);
  
  const hasItems = items.length > 0;
  const hasCompletedItems = items.some(item => item.status === 'completed' || item.status === 'failed');
  const completedCount = items.filter(item => item.status === 'completed').length;
  
  const isInitialMount = useRef(true);
  
  // Hydration effect - wait for component to fully mount before allowing celebrations
  useEffect(() => {
    setIsHydrated(true);
  }, []);
  
  // Set the origin ref for the celebration animation
  useEffect(() => {
    if (buttonRef.current) {
      setOriginRef(buttonRef as React.RefObject<HTMLElement>);
    }
  }, [setOriginRef]);
  
  // Trigger celebration animation when a new item completes (not on mount)
  useEffect(() => {
    // Skip on initial mount and before hydration - only fire when new items complete during session
    if (!isHydrated || isInitialMount.current) {
      if (isHydrated) {
        isInitialMount.current = false;
        prevCompletedCountRef.current = completedCount;
      }
      return;
    }
    
    if (completedCount > prevCompletedCountRef.current) {
      celebrate();
    }
    prevCompletedCountRef.current = completedCount;
  }, [completedCount, celebrate, isHydrated]);
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          ref={buttonRef}
          className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="greenfinch.ai"
          data-testid="button-greenfinch-agent"
        >
          <GreenfinchAgentIcon size={20} />
          {activeCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-green-500 text-white text-xs font-medium rounded-full flex items-center justify-center" data-testid="badge-active-enrichments">
              {activeCount}
            </span>
          )}
          {hasItems && activeCount === 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-gray-400 rounded-full" />
          )}
        </button>
      </PopoverTrigger>
      
      <PopoverContent className="w-80 p-0 bg-white dark:bg-gray-900 shadow-lg" align="end" data-testid="popover-enrichment-queue">
        <div className="p-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">greenfinch.ai</h3>
            {hasCompletedItems && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCompleted}
                className="text-xs h-7 px-2"
                data-testid="button-clear-completed"
              >
                Clear finished
              </Button>
            )}
          </div>
          {activeCount > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {activeCount} research task{activeCount !== 1 ? 's' : ''} in progress
            </p>
          )}
        </div>
        
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <GreenfinchAgentIcon size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No recent research</p>
              <p className="text-xs text-gray-400 mt-1">
                Research tasks will appear here
              </p>
            </div>
          ) : (
            items.map(item => (
              <QueueItem
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
