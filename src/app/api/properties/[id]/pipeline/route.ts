import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyPipeline, propertyActivity, users, PIPELINE_STATUSES, type PipelineStatus } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DCAD_KEY_REGEX = /^[0-9A-Z]{17,20}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const [pipelineResult] = await db
      .select({
        id: propertyPipeline.id,
        propertyId: propertyPipeline.propertyId,
        clerkOrgId: propertyPipeline.clerkOrgId,
        status: propertyPipeline.status,
        dealValue: propertyPipeline.dealValue,
        ownerId: propertyPipeline.ownerId,
        statusChangedAt: propertyPipeline.statusChangedAt,
        ownerFirstName: users.firstName,
        ownerLastName: users.lastName,
        ownerEmail: users.email,
        ownerProfileImage: users.profileImageUrl,
      })
      .from(propertyPipeline)
      .leftJoin(users, eq(propertyPipeline.ownerId, users.id))
      .where(
        and(
          eq(propertyPipeline.propertyId, property.id),
          eq(propertyPipeline.clerkOrgId, authData.orgId)
        )
      )
      .limit(1);

    const pipeline = pipelineResult ? {
      ...pipelineResult,
      owner: pipelineResult.ownerId ? {
        id: pipelineResult.ownerId,
        firstName: pipelineResult.ownerFirstName,
        lastName: pipelineResult.ownerLastName,
        email: pipelineResult.ownerEmail,
        profileImageUrl: pipelineResult.ownerProfileImage,
        displayName: [pipelineResult.ownerFirstName, pipelineResult.ownerLastName].filter(Boolean).join(' ') || pipelineResult.ownerEmail || 'Unknown',
      } : null,
    } : null;

    return NextResponse.json({
      pipeline: pipeline || {
        status: 'new' as PipelineStatus,
        dealValue: null,
        propertyId: property.id,
        clerkOrgId: authData.orgId,
        ownerId: null,
        owner: null,
      },
    });
  } catch (error) {
    console.error('[Pipeline API] Error fetching pipeline:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authData = await auth();
    if (!authData.userId || !authData.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json({ error: 'Invalid property ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { status, dealValue, autoClaim, ownerId } = body;

    if (!status || !PIPELINE_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    if (status === 'qualified' && (!dealValue || dealValue <= 1)) {
      return NextResponse.json(
        { error: 'Deal value must be greater than $1 when qualifying' },
        { status: 400 }
      );
    }

    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const [existingPipeline] = await db
      .select()
      .from(propertyPipeline)
      .where(
        and(
          eq(propertyPipeline.propertyId, property.id),
          eq(propertyPipeline.clerkOrgId, authData.orgId)
        )
      )
      .limit(1);

    const previousStatus = existingPipeline?.status || 'new';
    const previousDealValue = existingPipeline?.dealValue;

    let pipeline;
    if (existingPipeline) {
      // Determine if we should auto-assign ownership
      // Server-side guard: only auto-assign when transitioning from 'new' status with no owner
      const shouldAutoAssign = autoClaim && 
        !existingPipeline.ownerId && 
        existingPipeline.status === 'new' && 
        status !== 'new';
      
      [pipeline] = await db
        .update(propertyPipeline)
        .set({
          status,
          dealValue: dealValue || existingPipeline.dealValue,
          statusChangedAt: new Date(),
          statusChangedByUserId: session.user.id,
          updatedAt: new Date(),
          ...(shouldAutoAssign && { ownerId: session.user.id }),
        })
        .where(eq(propertyPipeline.id, existingPipeline.id))
        .returning();
      
      // Log ownership assignment activity if auto-claimed
      if (shouldAutoAssign) {
        await db.insert(propertyActivity).values({
          propertyId: property.id,
          clerkOrgId: authData.orgId,
          userId: session.user.id,
          activityType: 'owner_assigned',
          previousValue: null,
          newValue: session.user.id,
          metadata: { autoAssigned: true },
        });
      }
    } else {
      // For new pipeline entries, auto-assign if autoClaim is true or ownerId is provided
      const assignedOwnerId = ownerId || (autoClaim ? session.user.id : null);
      
      [pipeline] = await db
        .insert(propertyPipeline)
        .values({
          propertyId: property.id,
          clerkOrgId: authData.orgId,
          status,
          dealValue: dealValue || null,
          statusChangedByUserId: session.user.id,
          ...(assignedOwnerId && { ownerId: assignedOwnerId }),
        })
        .returning();
      
      // Log ownership assignment activity if owner assigned
      if (assignedOwnerId) {
        await db.insert(propertyActivity).values({
          propertyId: property.id,
          clerkOrgId: authData.orgId,
          userId: session.user.id,
          activityType: 'owner_assigned',
          previousValue: null,
          newValue: assignedOwnerId,
          metadata: { autoAssigned: autoClaim ? true : false, assignedBy: ownerId ? session.user.id : null },
        });
      }
    }

    if (previousStatus !== status) {
      await db.insert(propertyActivity).values({
        propertyId: property.id,
        clerkOrgId: authData.orgId,
        userId: session.user.id,
        activityType: 'status_change',
        previousValue: previousStatus,
        newValue: status,
        metadata: dealValue ? { dealValue } : null,
      });
    }
    
    // Always sync isCurrentCustomer with "won" status (handles both new transitions and existing data)
    if (status === 'won') {
      await db.update(propertyPipeline)
        .set({ isCurrentCustomer: true })
        .where(eq(propertyPipeline.id, pipeline.id));
      await db.update(properties)
        .set({ isCurrentCustomer: true })
        .where(eq(properties.id, property.id));
    } else if (previousStatus === 'won' && status !== 'won') {
      // Changing from won to another status, mark as not a customer
      await db.update(propertyPipeline)
        .set({ isCurrentCustomer: false })
        .where(eq(propertyPipeline.id, pipeline.id));
      await db.update(properties)
        .set({ isCurrentCustomer: false })
        .where(eq(properties.id, property.id));
    }

    if (dealValue && previousDealValue !== dealValue) {
      await db.insert(propertyActivity).values({
        propertyId: property.id,
        clerkOrgId: authData.orgId,
        userId: session.user.id,
        activityType: 'deal_value_updated',
        previousValue: previousDealValue?.toString() || null,
        newValue: dealValue.toString(),
      });
    }

    return NextResponse.json({ pipeline });
  } catch (error) {
    console.error('[Pipeline API] Error updating pipeline:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
