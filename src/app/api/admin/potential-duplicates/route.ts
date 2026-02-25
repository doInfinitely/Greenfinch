import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { potentialDuplicates, contacts } from '@/lib/schema';
import { eq, and, or, desc, inArray } from 'drizzle-orm';
import { mergeContacts } from '@/lib/deduplication';

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const flags = await db
      .select()
      .from(potentialDuplicates)
      .where(eq(potentialDuplicates.status, status))
      .orderBy(desc(potentialDuplicates.createdAt));

    const allIds = [...new Set(flags.flatMap(f => [f.contactIdA, f.contactIdB]))];
    const allContacts = allIds.length > 0
      ? await db.select().from(contacts).where(inArray(contacts.id, allIds))
      : [];
    const contactMap = new Map(allContacts.map(c => [c.id, c]));

    const pickFields = (c: typeof allContacts[number] | undefined) => c ? {
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      title: c.title,
      employerName: c.employerName,
      companyDomain: c.companyDomain,
      phone: c.phone,
      linkedinUrl: c.linkedinUrl,
      emailValidationStatus: c.emailValidationStatus,
      source: c.source,
    } : null;

    const enriched = flags.map(flag => ({
      ...flag,
      contactA: pickFields(contactMap.get(flag.contactIdA)),
      contactB: pickFields(contactMap.get(flag.contactIdB)),
    }));

    const valid = enriched.filter(e => e.contactA && e.contactB);

    return NextResponse.json({
      success: true,
      data: valid,
      meta: { total: valid.length, status },
    });
  } catch (error) {
    console.error('[PotentialDuplicates] GET error:', error);
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (error.message.startsWith('FORBIDDEN')) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to fetch potential duplicates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    await requireAdminAccess();

    const body = await request.json();
    const { flagId, action, keepContactId } = body;

    if (!flagId || !action) {
      return NextResponse.json({ error: 'Missing flagId or action' }, { status: 400 });
    }

    const [flag] = await db.select().from(potentialDuplicates).where(eq(potentialDuplicates.id, flagId));
    if (!flag) {
      return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
    }
    if (flag.status !== 'pending') {
      return NextResponse.json({ error: 'Flag already resolved' }, { status: 400 });
    }

    if (action === 'dismiss') {
      await db.update(potentialDuplicates)
        .set({
          status: 'dismissed',
          resolvedByUserId: session.user.clerkId,
          resolvedAt: new Date(),
        })
        .where(eq(potentialDuplicates.id, flagId));

      return NextResponse.json({ success: true, action: 'dismissed' });
    }

    if (action === 'merge') {
      if (!keepContactId) {
        return NextResponse.json({ error: 'Missing keepContactId for merge action' }, { status: 400 });
      }

      const deleteContactId = keepContactId === flag.contactIdA ? flag.contactIdB : flag.contactIdA;
      const [keepContact, deleteContact] = await Promise.all([
        db.query.contacts.findFirst({ where: eq(contacts.id, keepContactId) }),
        db.query.contacts.findFirst({ where: eq(contacts.id, deleteContactId) }),
      ]);

      if (!keepContact || !deleteContact) {
        return NextResponse.json({ error: 'One or both contacts no longer exist' }, { status: 404 });
      }

      const result = await mergeContacts([{
        key: `manual::${flag.matchKey}`,
        items: [keepContact, deleteContact],
        keepId: keepContactId,
        deleteIds: [deleteContactId],
      }]);

      await db.update(potentialDuplicates)
        .set({
          status: 'merged',
          resolvedByUserId: session.user.clerkId,
          resolvedAt: new Date(),
        })
        .where(eq(potentialDuplicates.id, flagId));

      const relatedFlags = await db.select({ id: potentialDuplicates.id }).from(potentialDuplicates).where(
        and(
          eq(potentialDuplicates.status, 'pending'),
          or(
            eq(potentialDuplicates.contactIdA, deleteContactId),
            eq(potentialDuplicates.contactIdB, deleteContactId)
          )
        )
      );
      if (relatedFlags.length > 0) {
        await db.update(potentialDuplicates)
          .set({
            status: 'merged',
            resolvedByUserId: session.user.clerkId,
            resolvedAt: new Date(),
          })
          .where(inArray(potentialDuplicates.id, relatedFlags.map(r => r.id)));
      }

      return NextResponse.json({
        success: true,
        action: 'merged',
        keepId: keepContactId,
        deletedId: deleteContactId,
        mergeResult: result,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use "merge" or "dismiss".' }, { status: 400 });
  } catch (error) {
    console.error('[PotentialDuplicates] POST error:', error);
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (error.message.startsWith('FORBIDDEN')) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to process duplicate action' }, { status: 500 });
  }
}
