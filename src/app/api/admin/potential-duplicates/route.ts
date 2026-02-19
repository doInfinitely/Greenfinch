import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { potentialDuplicates, contacts } from '@/lib/schema';
import { eq, and, or, desc } from 'drizzle-orm';
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

    const enriched = await Promise.all(
      flags.map(async (flag) => {
        const [contactA, contactB] = await Promise.all([
          db.query.contacts.findFirst({ where: eq(contacts.id, flag.contactIdA) }),
          db.query.contacts.findFirst({ where: eq(contacts.id, flag.contactIdB) }),
        ]);
        return {
          ...flag,
          contactA: contactA ? {
            id: contactA.id,
            fullName: contactA.fullName,
            email: contactA.email,
            title: contactA.title,
            employerName: contactA.employerName,
            companyDomain: contactA.companyDomain,
            phone: contactA.phone,
            linkedinUrl: contactA.linkedinUrl,
            emailValidationStatus: contactA.emailValidationStatus,
            source: contactA.source,
          } : null,
          contactB: contactB ? {
            id: contactB.id,
            fullName: contactB.fullName,
            email: contactB.email,
            title: contactB.title,
            employerName: contactB.employerName,
            companyDomain: contactB.companyDomain,
            phone: contactB.phone,
            linkedinUrl: contactB.linkedinUrl,
            emailValidationStatus: contactB.emailValidationStatus,
            source: contactB.source,
          } : null,
        };
      })
    );

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

      const relatedFlags = await db.select().from(potentialDuplicates).where(
        and(
          eq(potentialDuplicates.status, 'pending'),
          or(
            eq(potentialDuplicates.contactIdA, deleteContactId),
            eq(potentialDuplicates.contactIdB, deleteContactId)
          )
        )
      );
      for (const related of relatedFlags) {
        await db.update(potentialDuplicates)
          .set({
            status: 'merged',
            resolvedByUserId: session.user.clerkId,
            resolvedAt: new Date(),
          })
          .where(eq(potentialDuplicates.id, related.id));
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
