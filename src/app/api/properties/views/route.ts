import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { propertyViews, properties } from '@/lib/schema';
import { requireSession } from '@/lib/auth';
import { eq, and, inArray } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolvePropertyId(input: string): Promise<string | null> {
  if (UUID_REGEX.test(input)) return input;
  const [row] = await db.select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, input))
    .limit(1);
  return row?.id || null;
}

async function resolvePropertyIds(inputs: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const keysToLookup: string[] = [];
  for (const input of inputs) {
    if (UUID_REGEX.test(input)) {
      result.set(input, input);
    } else {
      keysToLookup.push(input);
    }
  }
  if (keysToLookup.length > 0) {
    const rows = await db.select({ id: properties.id, propertyKey: properties.propertyKey })
      .from(properties)
      .where(inArray(properties.propertyKey, keysToLookup));
    for (const row of rows) {
      result.set(row.propertyKey, row.id);
    }
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 403 });
    }

    const body = await request.json();
    const { propertyId: rawPropertyId } = body;

    if (!rawPropertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const propertyId = await resolvePropertyId(rawPropertyId);
    if (!propertyId) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    await db.insert(propertyViews).values({
      propertyId,
      userId: session.user.id,
      clerkOrgId: orgId,
      lastViewedAt: new Date(),
    }).onConflictDoUpdate({
      target: [propertyViews.userId, propertyViews.propertyId, propertyViews.clerkOrgId],
      set: { lastViewedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[PropertyViews API] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 403 });
    }

    const body = await request.json();
    const { propertyId: rawPropertyId } = body;

    if (!rawPropertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const propertyId = await resolvePropertyId(rawPropertyId);
    if (!propertyId) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    await db.delete(propertyViews)
      .where(and(
        eq(propertyViews.userId, session.user.id),
        eq(propertyViews.propertyId, propertyId),
        eq(propertyViews.clerkOrgId, orgId),
      ));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[PropertyViews API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const propertyIdsParam = searchParams.get('propertyIds');

    if (!propertyIdsParam) {
      return NextResponse.json({ error: 'propertyIds query param is required' }, { status: 400 });
    }

    const rawIds = propertyIdsParam.split(',').filter(Boolean);

    if (rawIds.length === 0) {
      return NextResponse.json({ views: {} });
    }

    const idMap = await resolvePropertyIds(rawIds);
    const resolvedUuids = Array.from(idMap.values());

    if (resolvedUuids.length === 0) {
      return NextResponse.json({ views: {} });
    }

    const viewRecords = await db.select().from(propertyViews)
      .where(and(
        eq(propertyViews.userId, session.user.id),
        eq(propertyViews.clerkOrgId, orgId),
        inArray(propertyViews.propertyId, resolvedUuids),
      ));

    const views: Record<string, string | null> = {};
    for (const rawId of rawIds) {
      const uuid = idMap.get(rawId);
      if (!uuid) {
        views[rawId] = null;
        continue;
      }
      const record = viewRecords.find(v => v.propertyId === uuid);
      views[rawId] = record?.lastViewedAt?.toISOString() ?? null;
    }

    return NextResponse.json({ views });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[PropertyViews API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
