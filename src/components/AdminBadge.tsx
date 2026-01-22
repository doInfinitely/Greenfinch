'use client';

import { useAuth } from '@clerk/nextjs';
import { isInternalOrg } from '@/lib/permissions';

export function AdminBadge() {
  const { orgSlug, orgRole } = useAuth();
  
  if (!isInternalOrg(orgSlug)) {
    return null;
  }
  
  const roleLabel = orgRole?.replace('org:', '').toUpperCase() || 'INTERNAL';
  
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500 text-white">
      {roleLabel}
    </span>
  );
}
