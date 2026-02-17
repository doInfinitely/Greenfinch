import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { propertyViews } from '@/lib/schema';
import { requireSession } from '@/lib/auth';
import { eq, and, inArray } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 403 });
    }

    const body = await request.json();
    const { propertyId } = body;

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    const existing = await db.select().from(propertyViews)
      .where(and(
        eq(propertyViews.userId, session.user.id),
        eq(propertyViews.propertyId, propertyId),
        eq(propertyViews.clerkOrgId, orgId),
      ));

    if (existing.length > 0) {
      await db.update(propertyViews)
        .set({ lastViewedAt: new Date() })
        .where(eq(propertyViews.id, existing[0].id));
    } else {
      await db.insert(propertyViews).values({
        propertyId,
        userId: session.user.id,
        clerkOrgId: orgId,
        lastViewedAt: new Date(),
      });
    }

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
    const { propertyId } = body;

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
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

    const propertyIds = propertyIdsParam.split(',').filter(Boolean);

    if (propertyIds.length === 0) {
      return NextResponse.json({ views: {} });
    }

    const viewRecords = await db.select().from(propertyViews)
      .where(and(
        eq(propertyViews.userId, session.user.id),
        eq(propertyViews.clerkOrgId, orgId),
        inArray(propertyViews.propertyId, propertyIds),
      ));

    const views: Record<string, string | null> = {};
    for (const id of propertyIds) {
      const record = viewRecords.find(v => v.propertyId === id);
      views[id] = record?.lastViewedAt?.toISOString() ?? null;
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
