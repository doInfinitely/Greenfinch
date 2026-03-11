'use client';

import { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useWalkthrough } from '@/contexts/WalkthroughContext';

interface FeatureTooltipProps {
  id: string;
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

export default function FeatureTooltip({ id, title, description, side = 'bottom', children }: FeatureTooltipProps) {
  const { isTooltipDismissed, dismissTooltip, state } = useWalkthrough();

  if (!state || state.skippedAll || isTooltipDismissed(id)) {
    return <>{children}</>;
  }

  return (
    <Popover defaultOpen>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} className="w-64 p-3" sideOffset={8}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-900">{title}</p>
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          </div>
          <button
            onClick={() => dismissTooltip(id)}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
            aria-label="Dismiss hint"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
