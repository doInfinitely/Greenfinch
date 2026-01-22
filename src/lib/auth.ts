import { db } from './db';
import { users, serviceProviders } from './schema';
import { eq, ilike } from 'drizzle-orm';
import { currentUser, auth } from '@clerk/nextjs/server';
import { ROLES, isInternalOrg, Permission, getRolePermissions } from './permissions';

export type UserRole = 'standard_user' | 'team_manager' | 'account_admin' | 'system_admin';

export interface User {
  id: string;
  clerkId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: UserRole;
  isActive: boolean;
}

function extractDomain(email: string | undefined | null): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

async function findMatchingServiceProvider(email: string | undefined | null): Promise<{ id: string; name: string } | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  try {
    const [provider] = await db
      .select({ id: serviceProviders.id, name: serviceProviders.name })
      .from(serviceProviders)
      .where(ilike(serviceProviders.domain, domain))
      .limit(1);

    return provider || null;
  } catch (error) {
    console.error('[Auth] Error finding matching service provider:', error);
    return null;
  }
}

export async function getSession(): Promise<{ user: User } | null> {
  try {
    const clerkUser = await currentUser();
    
    if (!clerkUser) return null;
    
    const dbUser = await getOrCreateUser(clerkUser);
    
    if (!dbUser || !dbUser.isActive) return null;
    
    return { user: dbUser };
  } catch (error) {
    console.error('[Auth] Error getting session:', error);
    return null;
  }
}

export async function requireSession(): Promise<{ user: User }> {
  const session = await getSession();
  if (!session) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

export async function requireRole(allowedRoles: UserRole[]): Promise<{ user: User }> {
  const session = await requireSession();
  if (!allowedRoles.includes(session.user.role)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}

export function isAdmin(user: User): boolean {
  return user.role === 'system_admin' || user.role === 'account_admin';
}

export function isSystemAdmin(user: User): boolean {
  return user.role === 'system_admin';
}

interface ClerkUser {
  id: string;
  emailAddresses: Array<{ emailAddress: string }>;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

async function getOrCreateUser(clerkUser: ClerkUser): Promise<User | null> {
  const primaryEmail = clerkUser.emailAddresses[0]?.emailAddress || null;
  
  // First, try to find by clerkId
  const existingByClerkId = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkUser.id))
    .limit(1);
  
  if (existingByClerkId.length > 0) {
    const existingUser = existingByClerkId[0];
    return await updateExistingUser(clerkUser, existingUser, primaryEmail);
  }
  
  // Fallback: Try to find by email (for legacy users migrating from Replit Auth)
  if (primaryEmail) {
    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, primaryEmail))
      .limit(1);
    
    if (existingByEmail.length > 0) {
      const existingUser = existingByEmail[0];
      console.log(`[Auth] Migrating legacy user ${primaryEmail} to Clerk ID ${clerkUser.id}`);
      
      // Link Clerk ID to existing user
      const [updated] = await db
        .update(users)
        .set({
          clerkId: clerkUser.id,
          firstName: clerkUser.firstName || existingUser.firstName,
          lastName: clerkUser.lastName || existingUser.lastName,
          profileImageUrl: clerkUser.imageUrl || existingUser.profileImageUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id))
        .returning();
      
      return {
        id: updated.id,
        clerkId: updated.clerkId || '',
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        profileImageUrl: updated.profileImageUrl,
        role: (updated.role as UserRole) || 'standard_user',
        isActive: updated.isActive ?? true,
      };
    }
  }
  
  // Create new user
  const matchingProvider = await findMatchingServiceProvider(primaryEmail);
  const domain = extractDomain(primaryEmail);
  
  const [newUser] = await db
    .insert(users)
    .values({
      clerkId: clerkUser.id,
      email: primaryEmail,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      profileImageUrl: clerkUser.imageUrl,
      companyDomain: domain,
      companyName: matchingProvider?.name || null,
      serviceProviderId: matchingProvider?.id || null,
      isActive: true,
    })
    .returning();
  
  if (matchingProvider) {
    console.log(`[Auth] New user ${clerkUser.id} auto-linked to service provider: ${matchingProvider.name}`);
  }
  
  return {
    id: newUser.id,
    clerkId: newUser.clerkId || '',
    email: newUser.email,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    profileImageUrl: newUser.profileImageUrl,
    role: (newUser.role as UserRole) || 'standard_user',
    isActive: newUser.isActive ?? true,
  };
}

async function updateExistingUser(
  clerkUser: ClerkUser,
  existingUser: typeof users.$inferSelect,
  primaryEmail: string | null
): Promise<User> {
  // Check if we should link to a service provider
  if (primaryEmail && !existingUser.serviceProviderId) {
    const matchingProvider = await findMatchingServiceProvider(primaryEmail);
    if (matchingProvider) {
      console.log(`[Auth] Linking user ${clerkUser.id} to service provider: ${matchingProvider.name}`);
      
      const [updated] = await db
        .update(users)
        .set({
          email: primaryEmail,
          firstName: clerkUser.firstName || existingUser.firstName,
          lastName: clerkUser.lastName || existingUser.lastName,
          profileImageUrl: clerkUser.imageUrl || existingUser.profileImageUrl,
          companyDomain: extractDomain(primaryEmail),
          companyName: matchingProvider.name,
          serviceProviderId: matchingProvider.id,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id))
        .returning();
      
      return {
        id: updated.id,
        clerkId: updated.clerkId || '',
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        profileImageUrl: updated.profileImageUrl,
        role: (updated.role as UserRole) || 'standard_user',
        isActive: updated.isActive ?? true,
      };
    }
  }
  
  // Standard update
  const [updated] = await db
    .update(users)
    .set({
      email: primaryEmail || existingUser.email,
      firstName: clerkUser.firstName || existingUser.firstName,
      lastName: clerkUser.lastName || existingUser.lastName,
      profileImageUrl: clerkUser.imageUrl || existingUser.profileImageUrl,
      updatedAt: new Date(),
    })
    .where(eq(users.id, existingUser.id))
    .returning();
  
  return {
    id: updated.id,
    clerkId: updated.clerkId || '',
    email: updated.email,
    firstName: updated.firstName,
    lastName: updated.lastName,
    profileImageUrl: updated.profileImageUrl,
    role: (updated.role as UserRole) || 'standard_user',
    isActive: updated.isActive ?? true,
  };
}

export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

export async function getUserPermissions(): Promise<Set<Permission>> {
  const authData = await auth();
  const permissions = new Set<Permission>();
  
  const orgRole = authData.orgRole;
  if (orgRole) {
    getRolePermissions(orgRole).forEach(p => permissions.add(p));
  }
  
  return permissions;
}

export async function hasPermission(permission: Permission): Promise<boolean> {
  const permissions = await getUserPermissions();
  return permissions.has(permission);
}

export async function isInternalUser(): Promise<boolean> {
  const user = await currentUser();
  const memberships = (user as { organizationMemberships?: Array<{ organization: { slug: string } }> })?.organizationMemberships;
  return memberships?.some(
    (mem) => isInternalOrg(mem.organization.slug)
  ) ?? false;
}

export async function isInternalAdmin(): Promise<boolean> {
  const authData = await auth();
  return isInternalOrg(authData.orgSlug) && 
         (authData.orgRole === 'org:super_admin' || authData.orgRole === 'org:admin');
}

export async function requirePermission(permission: Permission): Promise<void> {
  if (!(await hasPermission(permission))) {
    throw new Error(`FORBIDDEN: Missing permission ${permission}`);
  }
}
