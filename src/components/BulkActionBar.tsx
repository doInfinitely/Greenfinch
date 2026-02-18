'use client';

import { X } from 'lucide-react';

interface BulkActionBarProps {
  selectedCount: number;
  itemLabel?: string;
  onDeselectAll: () => void;
  children?: React.ReactNode;
}

export function BulkActionBar({ 
  selectedCount, 
  itemLabel = 'item',
  onDeselectAll,
  children 
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const pluralLabel = selectedCount === 1 ? itemLabel : `${itemLabel}s`;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:right-auto z-50 bg-gray-900 text-white md:rounded-lg shadow-lg px-4 py-3 safe-bottom"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      data-testid="bulk-action-bar"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <div className="flex items-center justify-between md:justify-start gap-3">
          <span className="text-sm font-medium whitespace-nowrap" data-testid="text-selected-count">
            {selectedCount} {pluralLabel} selected
          </span>
          <button
            onClick={onDeselectAll}
            className="flex items-center gap-1 text-sm text-gray-300 active:text-white transition-colors touch-manipulation min-h-[44px] md:min-h-0"
            data-testid="button-deselect-all"
          >
            <X className="h-4 w-4" />
            Deselect
          </button>
        </div>
        {children && (
          <>
            <div className="hidden md:block w-px h-6 bg-gray-700" />
            <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 md:pb-0">
              {children}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
