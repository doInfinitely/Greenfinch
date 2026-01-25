import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { propertyServiceProviders, serviceProviders, properties } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DCAD_KEY_REGEX = /^[0-9A-Z]{17,20}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json(
        { error: 'Invalid property ID format' },
        { status: 400 }
      );
    }

    // Find property first to get UUID id
    const isUuid = UUID_REGEX.test(id);
    const [property] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id))
      .limit(1);

    if (!property) {
      return NextResponse.json({ providers: [] });
    }

    const providers = await db
      .select({
        id: propertyServiceProviders.id,
        serviceCategory: propertyServiceProviders.serviceCategory,
        status: propertyServiceProviders.status,
        confidence: propertyServiceProviders.confidence,
        notes: propertyServiceProviders.notes,
        providerId: serviceProviders.id,
        providerName: serviceProviders.name,
        providerDomain: serviceProviders.domain,
        providerPhone: serviceProviders.phone,
      })
      .from(propertyServiceProviders)
      .leftJoin(serviceProviders, eq(propertyServiceProviders.serviceProviderId, serviceProviders.id))
      .where(eq(propertyServiceProviders.propertyId, property.id));

    return NextResponse.json({ providers });
  } catch (error) {
    console.error('[API] Get property service providers error:', error);
    return NextResponse.json(
      { error: 'Failed to get service providers' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession();

    // Require authentication for mutations
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!id || (!UUID_REGEX.test(id) && !DCAD_KEY_REGEX.test(id))) {
      return NextResponse.json(
        { error: 'Invalid property ID format' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { serviceCategory, serviceProviderId, notes } = body;

    if (!serviceCategory || !serviceProviderId) {
      return NextResponse.json(
        { error: 'Service category and provider are required' },
        { status: 400 }
      );
    }

    // Verify property exists - handle both UUID and DCAD key formats
    const isUuid = UUID_REGEX.test(id);
    const property = await db.query.properties.findFirst({
      where: isUuid ? eq(properties.id, id) : eq(properties.propertyKey, id),
    });

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // Check if a provider already exists for this service category
    const existing = await db.query.propertyServiceProviders.findFirst({
      where: and(
        eq(propertyServiceProviders.propertyId, property.id),
        eq(propertyServiceProviders.serviceCategory, serviceCategory)
      ),
    });

    if (existing) {
      // Update existing
      await db
        .update(propertyServiceProviders)
        .set({
          serviceProviderId,
          notes,
          status: 'suggested',
          suggestedByUserId: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(propertyServiceProviders.id, existing.id));
    } else {
      // Create new
      await db.insert(propertyServiceProviders).values({
        propertyId: property.id,
        serviceProviderId,
        serviceCategory,
        notes,
        status: 'suggested',
        suggestedByUserId: session.user.id,
      });
    }

    console.log(`[API] Service provider suggested for property ${id}: ${serviceCategory}`);

    return NextResponse.json({
      success: true,
      message: 'Service provider suggested successfully',
    });
  } catch (error) {
    console.error('[API] Add service provider error:', error);
    return NextResponse.json(
      { error: 'Failed to add service provider' },
      { status: 500 }
    );
  }
}
