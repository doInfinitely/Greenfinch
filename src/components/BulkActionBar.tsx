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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-4"
      data-testid="bulk-action-bar"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium" data-testid="text-selected-count">
          {selectedCount} {pluralLabel} selected
        </span>
        <button
          onClick={onDeselectAll}
          className="flex items-center gap-1 text-sm text-gray-300 hover:text-white transition-colors"
          data-testid="button-deselect-all"
        >
          <X className="h-4 w-4" />
          Deselect all
        </button>
      </div>
      {children && (
        <>
          <div className="w-px h-6 bg-gray-700" />
          <div className="flex items-center gap-2">
            {children}
          </div>
        </>
      )}
    </div>
  );
}
