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

    const [pipeline] = await db
      .select()
      .from(propertyPipeline)
      .where(
        and(
          eq(propertyPipeline.propertyId, property.id),
          eq(propertyPipeline.clerkOrgId, authData.orgId)
        )
      )
      .limit(1);

    return NextResponse.json({
      pipeline: pipeline || {
        status: 'new' as PipelineStatus,
        dealValue: null,
        propertyId: property.id,
        clerkOrgId: authData.orgId,
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
    const { status, dealValue } = body;

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
      [pipeline] = await db
        .update(propertyPipeline)
        .set({
          status,
          dealValue: dealValue || existingPipeline.dealValue,
          statusChangedAt: new Date(),
          statusChangedByUserId: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(propertyPipeline.id, existingPipeline.id))
        .returning();
    } else {
      [pipeline] = await db
        .insert(propertyPipeline)
        .values({
          propertyId: property.id,
          clerkOrgId: authData.orgId,
          status,
          dealValue: dealValue || null,
          statusChangedByUserId: session.user.id,
        })
        .returning();
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
