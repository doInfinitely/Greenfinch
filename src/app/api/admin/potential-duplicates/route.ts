import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { potentialDuplicates, contacts, organizations, properties } from '@/lib/schema';
import { eq, and, or, desc, inArray } from 'drizzle-orm';
import { mergeContacts, mergeOrganizationPair, mergeProperties } from '@/lib/deduplication';

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    await requireAdminAccess();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const entityType = searchParams.get('entityType') || 'contact';

    const flags = await db
      .select()
      .from(potentialDuplicates)
      .where(
        and(
          eq(potentialDuplicates.status, status),
          eq(potentialDuplicates.entityType, entityType)
        )
      )
      .orderBy(desc(potentialDuplicates.confidence), desc(potentialDuplicates.createdAt));

    if (entityType === 'contact') {
      // Contact-specific enrichment (backward compatible)
      const allIds = [...new Set(flags.flatMap(f => [f.contactIdA, f.contactIdB].filter(Boolean) as string[]))];
      const allContacts = allIds.length > 0
        ? await db.select().from(contacts).where(inArray(contacts.id, allIds))
        : [];
      const contactMap = new Map(allContacts.map(c => [c.id, c]));

      const pickContactFields = (c: typeof allContacts[number] | undefined) => c ? {
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
        contactA: pickContactFields(contactMap.get(flag.contactIdA!)),
        contactB: pickContactFields(contactMap.get(flag.contactIdB!)),
        entityA: null,
        entityB: null,
      }));

      const valid = enriched.filter(e => e.contactA && e.contactB);
      return NextResponse.json({ success: true, data: valid, meta: { total: valid.length, status, entityType } });
    }

    if (entityType === 'organization') {
      const allIds = [...new Set(flags.flatMap(f => [f.entityIdA, f.entityIdB].filter(Boolean) as string[]))];
      const allOrgs = allIds.length > 0
        ? await db.select().from(organizations).where(inArray(organizations.id, allIds))
        : [];
      const orgMap = new Map(allOrgs.map(o => [o.id, o]));

      const pickOrgFields = (o: typeof allOrgs[number] | undefined) => o ? {
        id: o.id,
        name: o.name,
        domain: o.domain,
        logoUrl: o.logoUrl,
        city: o.city,
        state: o.state,
        employees: o.employees,
        linkedinHandle: o.linkedinHandle,
      } : null;

      const enriched = flags.map(flag => ({
        ...flag,
        contactA: null,
        contactB: null,
        entityA: pickOrgFields(orgMap.get(flag.entityIdA!)),
        entityB: pickOrgFields(orgMap.get(flag.entityIdB!)),
      }));

      const valid = enriched.filter(e => e.entityA && e.entityB);
      return NextResponse.json({ success: true, data: valid, meta: { total: valid.length, status, entityType } });
    }

    if (entityType === 'property') {
      const allIds = [...new Set(flags.flatMap(f => [f.entityIdA, f.entityIdB].filter(Boolean) as string[]))];
      const allProps = allIds.length > 0
        ? await db.select().from(properties).where(inArray(properties.id, allIds))
        : [];
      const propMap = new Map(allProps.map(p => [p.id, p]));

      const pickPropFields = (p: typeof allProps[number] | undefined) => p ? {
        id: p.id,
        validatedAddress: p.validatedAddress,
        regridAddress: p.regridAddress,
        city: p.city,
        state: p.state,
        dcadOwnerName1: p.dcadOwnerName1,
        beneficialOwner: p.beneficialOwner,
        assetCategory: p.assetCategory,
        enrichmentStatus: p.enrichmentStatus,
      } : null;

      const enriched = flags.map(flag => ({
        ...flag,
        contactA: null,
        contactB: null,
        entityA: pickPropFields(propMap.get(flag.entityIdA!)),
        entityB: pickPropFields(propMap.get(flag.entityIdB!)),
      }));

      const valid = enriched.filter(e => e.entityA && e.entityB);
      return NextResponse.json({ success: true, data: valid, meta: { total: valid.length, status, entityType } });
    }

    return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 });
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
    const { flagId, action, keepContactId, keepEntityId } = body;

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
      const entityType = flag.entityType || 'contact';

      if (entityType === 'contact') {
        const keepId = keepContactId || keepEntityId;
        if (!keepId) {
          return NextResponse.json({ error: 'Missing keepContactId for merge action' }, { status: 400 });
        }

        const deleteContactId = keepId === flag.contactIdA ? flag.contactIdB : flag.contactIdA;
        const [keepContact, deleteContact] = await Promise.all([
          db.query.contacts.findFirst({ where: eq(contacts.id, keepId) }),
          db.query.contacts.findFirst({ where: eq(contacts.id, deleteContactId!) }),
        ]);

        if (!keepContact || !deleteContact) {
          return NextResponse.json({ error: 'One or both contacts no longer exist' }, { status: 404 });
        }

        const result = await mergeContacts([{
          key: `manual::${flag.matchKey}`,
          items: [keepContact, deleteContact],
          keepId: keepId,
          deleteIds: [deleteContactId!],
        }]);

        await resolveFlag(flagId, session.user.clerkId);
        await cascadeResolveRelatedFlags(deleteContactId!, session.user.clerkId, 'contact');

        return NextResponse.json({
          success: true,
          action: 'merged',
          keepId,
          deletedId: deleteContactId,
          mergeResult: result,
        });
      }

      if (entityType === 'organization') {
        const keepId = keepEntityId;
        if (!keepId) {
          return NextResponse.json({ error: 'Missing keepEntityId for merge action' }, { status: 400 });
        }

        const deleteId = keepId === flag.entityIdA ? flag.entityIdB : flag.entityIdA;
        const result = await mergeOrganizationPair(keepId, deleteId!);

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        await resolveFlag(flagId, session.user.clerkId);
        await cascadeResolveRelatedFlags(deleteId!, session.user.clerkId, 'organization');

        return NextResponse.json({ success: true, action: 'merged', keepId, deletedId: deleteId, stats: result.stats });
      }

      if (entityType === 'property') {
        const keepId = keepEntityId;
        if (!keepId) {
          return NextResponse.json({ error: 'Missing keepEntityId for merge action' }, { status: 400 });
        }

        const deleteId = keepId === flag.entityIdA ? flag.entityIdB : flag.entityIdA;
        await mergeProperties(keepId, deleteId!);

        await resolveFlag(flagId, session.user.clerkId);
        await cascadeResolveRelatedFlags(deleteId!, session.user.clerkId, 'property');

        return NextResponse.json({ success: true, action: 'merged', keepId, deletedId: deleteId });
      }

      return NextResponse.json({ error: 'Unknown entity type' }, { status: 400 });
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

async function resolveFlag(flagId: string, userId: string) {
  await db.update(potentialDuplicates)
    .set({
      status: 'merged',
      resolvedByUserId: userId,
      resolvedAt: new Date(),
    })
    .where(eq(potentialDuplicates.id, flagId));
}

async function cascadeResolveRelatedFlags(deletedEntityId: string, userId: string, entityType: string) {
  const relatedFlags = await db.select({ id: potentialDuplicates.id }).from(potentialDuplicates).where(
    and(
      eq(potentialDuplicates.status, 'pending'),
      eq(potentialDuplicates.entityType, entityType),
      or(
        eq(potentialDuplicates.entityIdA, deletedEntityId),
        eq(potentialDuplicates.entityIdB, deletedEntityId)
      )
    )
  );

  // Also check legacy contact columns
  if (entityType === 'contact') {
    const legacyFlags = await db.select({ id: potentialDuplicates.id }).from(potentialDuplicates).where(
      and(
        eq(potentialDuplicates.status, 'pending'),
        or(
          eq(potentialDuplicates.contactIdA, deletedEntityId),
          eq(potentialDuplicates.contactIdB, deletedEntityId)
        )
      )
    );
    relatedFlags.push(...legacyFlags);
  }

  if (relatedFlags.length > 0) {
    const ids = [...new Set(relatedFlags.map(r => r.id))];
    await db.update(potentialDuplicates)
      .set({
        status: 'merged',
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      })
      .where(inArray(potentialDuplicates.id, ids));
  }
}
