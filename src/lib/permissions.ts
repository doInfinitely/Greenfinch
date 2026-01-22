export const PERMISSIONS = {
  'data:read': 'View property data',
  'data:write': 'Edit property data',
  'data:delete': 'Delete property data',
  'data:export': 'Export/download data',
  
  'admin:users': 'Manage users',
  'admin:billing': 'Manage billing',
  'admin:settings': 'Manage system settings',
  'admin:impersonate': 'Impersonate customers',
  'admin:ingest': 'Run data ingestion',
  'admin:enrich': 'Run enrichment processes',
  
  'properties:view': 'View properties',
  'properties:enrich': 'Run enrichment',
  'contacts:view': 'View contacts',
  'contacts:edit': 'Edit contacts',
  'organizations:view': 'View organizations',
  'lists:manage': 'Manage lists',
  'reports:create': 'Create reports',
  'api:access': 'API access',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  'org:super_admin': [
    'data:read', 'data:write', 'data:delete', 'data:export',
    'admin:users', 'admin:billing', 'admin:settings', 'admin:impersonate',
    'admin:ingest', 'admin:enrich',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create', 'api:access',
  ],
  'org:admin': [
    'data:read', 'data:write', 'data:export',
    'admin:users', 'admin:impersonate', 'admin:ingest', 'admin:enrich',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create', 'api:access',
  ],
  'org:support': [
    'data:read',
    'admin:impersonate',
    'properties:view', 'contacts:view', 'organizations:view',
  ],
  'org:member': [
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create',
  ],
  'org:viewer': [
    'properties:view', 'contacts:view', 'organizations:view',
  ],
} as const;

export const INTERNAL_ORG_SLUG_PREFIX = 'greenfinch';

export function isInternalOrg(orgSlug: string | null | undefined): boolean {
  return orgSlug?.startsWith(INTERNAL_ORG_SLUG_PREFIX) ?? false;
}

export function getRolePermissions(orgRole: string | null | undefined): Permission[] {
  if (!orgRole) return [];
  const role = orgRole as keyof typeof ROLES;
  return (ROLES[role] as readonly string[] | undefined)?.slice() as Permission[] || [];
}
