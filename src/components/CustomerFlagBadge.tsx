'use client';

import { UserCheck, Swords, Ban, Flame, FileSignature, History, type LucideIcon } from 'lucide-react';
import { CUSTOMER_FLAG_CONFIG, type CustomerFlagType } from '@/lib/customer-flags';

const ICON_MAP: Record<string, LucideIcon> = {
  UserCheck,
  Swords,
  Ban,
  Flame,
  FileSignature,
  History,
};

interface CustomerFlagBadgeProps {
  flagType: CustomerFlagType;
  competitorName?: string | null;
  size?: 'sm' | 'xs';
}

export default function CustomerFlagBadge({ flagType, competitorName, size = 'sm' }: CustomerFlagBadgeProps) {
  const config = CUSTOMER_FLAG_CONFIG[flagType];
  if (!config) return null;

  const Icon = ICON_MAP[config.icon];
  const isXs = size === 'xs';

  const label = flagType === 'competitor_serviced' && competitorName
    ? `${config.label}: ${competitorName}`
    : config.label;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${config.color} ${config.textColor} ${
        isXs ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      {Icon && <Icon className={isXs ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
      {label}
    </span>
  );
}
