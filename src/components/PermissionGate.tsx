'use client';

import { useAuth } from '@clerk/nextjs';
import { ROLES, INTERNAL_ORG_SLUG, Permission } from '@/lib/permissions';

interface PermissionGateProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const { orgRole } = useAuth();
  
  const permissions = new Set<string>(
    ROLES[orgRole as keyof typeof ROLES] ?? []
  );
  
  if (!permissions.has(permission)) {
    return <>{fallback}</>;
  }
  
  return <>{children}</>;
}

interface InternalOnlyProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function InternalOnly({ children, fallback = null }: InternalOnlyProps) {
  const { orgSlug } = useAuth();
  
  if (orgSlug !== INTERNAL_ORG_SLUG) {
    return <>{fallback}</>;
  }
  
  return <>{children}</>;
}

interface AdminOnlyProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AdminOnly({ children, fallback = null }: AdminOnlyProps) {
  const { orgSlug, orgRole } = useAuth();
  
  const isAdmin = orgSlug === INTERNAL_ORG_SLUG && 
    ['org:super_admin', 'org:admin'].includes(orgRole || '');
  
  if (!isAdmin) {
    return <>{fallback}</>;
  }
  
  return <>{children}</>;
}
