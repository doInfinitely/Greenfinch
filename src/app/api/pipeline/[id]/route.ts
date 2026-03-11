import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, users, PIPELINE_STATUSES, type PipelineStatus } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId: clerkUserId, orgRole } = await auth();
    
    if (!orgId || !clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status, ownerId, lostReason, lostNotes } = body;

    const existing = await db
      .select()
      .from(propertyPipeline)
      .where(
        and(
          eq(propertyPipeline.id, id),
          eq(propertyPipeline.clerkOrgId, orgId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Pipeline item not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (status !== undefined) {
      if (!PIPELINE_STATUSES.includes(status as PipelineStatus)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      updateData.status = status;
      updateData.statusChangedAt = new Date();

      if (status === 'lost') {
        updateData.lostReason = lostReason || null;
        updateData.lostNotes = lostNotes || null;
      }
    }

    if (ownerId !== undefined) {
      const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin' || orgRole === 'org:manager';

      if (!isAdmin) {
        return NextResponse.json({ error: 'Only admins and managers can assign owners' }, { status: 403 });
      }
      
      if (ownerId === null) {
        updateData.ownerId = null;
      } else {
        const client = await (await import('@clerk/nextjs/server')).clerkClient();
        const memberships = await client.organizations.getOrganizationMembershipList({
          organizationId: orgId,
          limit: 100,
        });
        
        const memberClerkIds = memberships.data
          .map(m => m.publicUserData?.userId)
          .filter(Boolean) as string[];
        
        const ownerRecord = await db
          .select({ id: users.id, clerkId: users.clerkId })
          .from(users)
          .where(eq(users.id, ownerId))
          .limit(1);
        
        if (ownerRecord.length === 0) {
          return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
        }
        
        if (!ownerRecord[0].clerkId || !memberClerkIds.includes(ownerRecord[0].clerkId)) {
          return NextResponse.json({ error: 'Owner must be a member of the organization' }, { status: 400 });
        }
        
        updateData.ownerId = ownerId;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    const [updated] = await db
      .update(propertyPipeline)
      .set(updateData)
      .where(
        and(
          eq(propertyPipeline.id, id),
          eq(propertyPipeline.clerkOrgId, orgId)
        )
      )
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating pipeline item:', error);
    return NextResponse.json({ error: 'Failed to update pipeline item' }, { status: 500 });
  }
}
