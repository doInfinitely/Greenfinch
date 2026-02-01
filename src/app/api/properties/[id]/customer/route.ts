import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties, propertyPipeline, propertyActivity } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DCAD_KEY_REGEX = /^[0-9A-Z]{17,20}$/i;

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
    const { isCurrentCustomer } = body;

    if (typeof isCurrentCustomer !== 'boolean') {
      return NextResponse.json({ error: 'isCurrentCustomer must be a boolean' }, { status: 400 });
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

    // Check for existing pipeline entry (org-scoped)
    const [existingPipeline] = await db
      .select()
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.propertyId, property.id),
        eq(propertyPipeline.clerkOrgId, authData.orgId)
      ))
      .limit(1);

    const previousValue = existingPipeline?.isCurrentCustomer ?? false;
    
    if (previousValue !== isCurrentCustomer) {
      if (existingPipeline) {
        // Update existing pipeline entry
        await db
          .update(propertyPipeline)
          .set({ 
            isCurrentCustomer,
            updatedAt: new Date(),
          })
          .where(eq(propertyPipeline.id, existingPipeline.id));
      } else {
        // Create new pipeline entry with customer status
        await db.insert(propertyPipeline).values({
          propertyId: property.id,
          clerkOrgId: authData.orgId,
          status: 'new',
          isCurrentCustomer,
        });
      }

      // Log activity
      await db.insert(propertyActivity).values({
        propertyId: property.id,
        clerkOrgId: authData.orgId,
        userId: session.user.id,
        activityType: 'customer_status_change',
        previousValue: previousValue?.toString() || 'false',
        newValue: isCurrentCustomer.toString(),
      });
    }

    return NextResponse.json({ success: true, isCurrentCustomer });
  } catch (error) {
    console.error('[Customer API] Error updating customer status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    // Get from pipeline table (org-scoped)
    const [pipeline] = await db
      .select({ isCurrentCustomer: propertyPipeline.isCurrentCustomer })
      .from(propertyPipeline)
      .where(and(
        eq(propertyPipeline.propertyId, property.id),
        eq(propertyPipeline.clerkOrgId, authData.orgId)
      ))
      .limit(1);

    return NextResponse.json({ isCurrentCustomer: pipeline?.isCurrentCustomer ?? false });
  } catch (error) {
    console.error('[Customer API] Error fetching customer status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
