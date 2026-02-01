'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GreenfinchAgentIconProps {
  className?: string;
  size?: number;
  isActive?: boolean;
  justCompleted?: boolean;
}

export default function GreenfinchAgentIcon({ 
  className = '', 
  size = 20,
  isActive = false,
  justCompleted = false,
}: GreenfinchAgentIconProps) {
  return (
    <Sparkles
      width={size}
      height={size}
      className={cn(
        className,
        isActive && 'text-purple-500 animate-pulse',
        justCompleted && 'text-green-500 animate-bounce'
      )}
      aria-label="AI Research"
    />
  );
}
