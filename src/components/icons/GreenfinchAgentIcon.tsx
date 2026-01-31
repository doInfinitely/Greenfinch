'use client';

import { Sparkles } from 'lucide-react';

interface GreenfinchAgentIconProps {
  className?: string;
  size?: number;
}

export default function GreenfinchAgentIcon({ className = '', size = 20 }: GreenfinchAgentIconProps) {
  return (
    <Sparkles
      width={size}
      height={size}
      className={className}
      aria-label="AI Research"
    />
  );
}
