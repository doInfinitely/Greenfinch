import { db } from './db';
import { territories } from './schema';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { clerkClient } from '@clerk/nextjs/server';

/**
 * Get user IDs that a manager is responsible for.
 *
 * Strategy:
 * 1. Find territories assigned to the manager
 * 2. Find other users assigned to the same territories
 * 3. Fallback: all non-admin org members if no territory assignments
 */
export async function getManagerTeamUserIds(
  orgId: string,
  managerClerkUserId: string
): Promise<string[]> {
  // Find territories assigned to this manager
  const managerTerritories = await db
    .select({ id: territories.id })
    .from(territories)
    .where(
      and(
        eq(territories.clerkOrgId, orgId),
        eq(territories.assignedClerkUserId, managerClerkUserId),
        eq(territories.isActive, true)
      )
    );

  if (managerTerritories.length > 0) {
    const territoryIds = managerTerritories.map(t => t.id);

    // Find all users assigned to the same territories
    const teamMembers = await db
      .select({ userId: territories.assignedClerkUserId })
      .from(territories)
      .where(
        and(
          eq(territories.clerkOrgId, orgId),
          isNotNull(territories.assignedClerkUserId),
          eq(territories.isActive, true),
          sql`${territories.id} = ANY(${territoryIds})`
        )
      );

    const userIds = new Set<string>();
    for (const m of teamMembers) {
      if (m.userId) userIds.add(m.userId);
    }
    // Always include the manager themselves
    userIds.add(managerClerkUserId);
    return Array.from(userIds);
  }

  // Fallback: all non-admin members in the org
  const client = await clerkClient();
  const members = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 500,
  });

  return members.data
    .filter(m => m.role !== 'org:admin' && m.role !== 'org:super_admin')
    .map(m => m.publicUserData?.userId)
    .filter((id): id is string => !!id);
}
