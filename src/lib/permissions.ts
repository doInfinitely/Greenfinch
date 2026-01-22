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
  'org:admin': [
    'data:read', 'data:write', 'data:delete', 'data:export',
    'admin:users', 'admin:billing', 'admin:settings', 'admin:impersonate',
    'admin:ingest', 'admin:enrich',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create', 'api:access',
  ],
  'org:member': [
    'data:read',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create',
  ],
} as const;

export const INTERNAL_ORG_SLUG = 'greenfinch';

export function getRolePermissions(orgRole: string | null | undefined): Permission[] {
  if (!orgRole) return [];
  const role = orgRole as keyof typeof ROLES;
  return (ROLES[role] as readonly string[] | undefined)?.slice() as Permission[] || [];
}
