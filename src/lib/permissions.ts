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
  'team:view-activity': 'View team activity',
  'territories:assign': 'Assign territories',
  'pipeline:assign': 'Assign pipeline deals',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  'org:admin': [
    'data:read', 'data:write', 'data:delete', 'data:export',
    'admin:users', 'admin:billing', 'admin:settings', 'admin:impersonate',
    'admin:ingest', 'admin:enrich',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create', 'api:access',
    'team:view-activity', 'territories:assign', 'pipeline:assign',
  ],
  'org:manager': [
    'data:read', 'data:write', 'data:delete', 'data:export',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create',
    'team:view-activity', 'territories:assign', 'pipeline:assign',
  ],
  'org:member': [
    'data:read',
    'properties:view', 'properties:enrich', 'contacts:view', 'contacts:edit',
    'organizations:view', 'lists:manage', 'reports:create',
  ],
} as const;

export const INTERNAL_ORG_SLUG = 'greenfinch';

export const ADMIN_EMAILS: readonly string[] = [
  'jordan@greenfinch.ai',
  'cory@greenfinch.ai',
  'remy@greenfinch.ai',
];

export function getRolePermissions(orgRole: string | null | undefined): Permission[] {
  if (!orgRole) return [];
  const role = orgRole as keyof typeof ROLES;
  return (ROLES[role] as readonly string[] | undefined)?.slice() as Permission[] || [];
}

export function isAdminOrManager(orgRole: string | null | undefined): boolean {
  return orgRole === 'org:admin' || orgRole === 'org:super_admin' || orgRole === 'org:manager';
}

export function isAdmin(orgRole: string | null | undefined): boolean {
  return orgRole === 'org:admin' || orgRole === 'org:super_admin';
}
