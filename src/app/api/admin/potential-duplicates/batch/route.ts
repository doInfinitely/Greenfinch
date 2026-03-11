import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  potentialDuplicates,
  contacts,
  organizations,
  properties,
  adminAuditLog,
} from '@/lib/schema';
import { eq, and, or, inArray, gte } from 'drizzle-orm';
import { mergeContacts, mergeOrganizationPair, mergeProperties } from '@/lib/deduplication';

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    await requireAdminAccess();

    const body = await request.json();
    const { action, flagIds, entityType, minConfidence } = body;

    if (!action || !['merge', 'dismiss'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Use "merge" or "dismiss".' }, { status: 400 });
    }

    // Resolve which flags to process
    let flags: (typeof potentialDuplicates.$inferSelect)[];

    if (flagIds && Array.isArray(flagIds) && flagIds.length > 0) {
      flags = await db.select().from(potentialDuplicates)
        .where(and(
          inArray(potentialDuplicates.id, flagIds),
          eq(potentialDuplicates.status, 'pending')
        ));
    } else if (entityType && minConfidence) {
      flags = await db.select().from(potentialDuplicates)
        .where(and(
          eq(potentialDuplicates.status, 'pending'),
          eq(potentialDuplicates.entityType, entityType),
          gte(potentialDuplicates.confidence, minConfidence)
        ));
    } else {
      return NextResponse.json({ error: 'Provide flagIds array or entityType+minConfidence' }, { status: 400 });
    }

    const result = { processed: 0, succeeded: 0, failed: 0, errors: [] as string[] };

    if (action === 'dismiss') {
      for (const flag of flags) {
        try {
          await db.update(potentialDuplicates)
            .set({
              status: 'dismissed',
              resolvedByUserId: session.user.clerkId,
              resolvedAt: new Date(),
            })
            .where(eq(potentialDuplicates.id, flag.id));
          result.processed++;
          result.succeeded++;
        } catch (err) {
          result.processed++;
          result.failed++;
          result.errors.push(`Failed to dismiss ${flag.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      }
    }

    if (action === 'merge') {
      for (const flag of flags) {
        result.processed++;
        try {
          const eType = flag.entityType || 'contact';

          if (eType === 'contact') {
            const idA = flag.contactIdA || flag.entityIdA;
            const idB = flag.contactIdB || flag.entityIdB;
            if (!idA || !idB) { result.failed++; continue; }

            const [contactA, contactB] = await Promise.all([
              db.query.contacts.findFirst({ where: eq(contacts.id, idA) }),
              db.query.contacts.findFirst({ where: eq(contacts.id, idB) }),
            ]);
            if (!contactA || !contactB) { result.failed++; continue; }

            // Auto-pick keeper: prefer valid email, then enriched, then most recently enriched
            const [keep, del] = pickKeeper(contactA, contactB);
            await mergeContacts([{
              key: `batch::${flag.matchKey}`,
              items: [keep, del],
              keepId: keep.id,
              deleteIds: [del.id],
            }]);
            result.succeeded++;
          } else if (eType === 'organization') {
            const idA = flag.entityIdA;
            const idB = flag.entityIdB;
            if (!idA || !idB) { result.failed++; continue; }

            const [orgA] = await db.select().from(organizations).where(eq(organizations.id, idA));
            const [orgB] = await db.select().from(organizations).where(eq(organizations.id, idB));
            if (!orgA || !orgB) { result.failed++; continue; }

            // Auto-pick keeper: prefer enriched, then more fields filled
            const keepOrg = orgA.providerId ? orgA : orgB.providerId ? orgB : orgA;
            const deleteOrg = keepOrg.id === orgA.id ? orgB : orgA;

            const mergeResult = await mergeOrganizationPair(keepOrg.id, deleteOrg.id);
            if (mergeResult.success) { result.succeeded++; } else { result.failed++; result.errors.push(mergeResult.error || 'Org merge failed'); }
          } else if (eType === 'property') {
            const idA = flag.entityIdA;
            const idB = flag.entityIdB;
            if (!idA || !idB) { result.failed++; continue; }

            const [propA] = await db.select().from(properties).where(eq(properties.id, idA));
            const [propB] = await db.select().from(properties).where(eq(properties.id, idB));
            if (!propA || !propB) { result.failed++; continue; }

            // Auto-pick keeper: prefer validated address, then more data
            const keepProp = propA.validatedAddress ? propA : propB.validatedAddress ? propB : propA;
            const deleteProp = keepProp.id === propA.id ? propB : propA;

            await mergeProperties(keepProp.id, deleteProp.id);
            result.succeeded++;
          }

          // Mark flag as merged
          await db.update(potentialDuplicates)
            .set({
              status: 'merged',
              resolvedByUserId: session.user.clerkId,
              resolvedAt: new Date(),
            })
            .where(eq(potentialDuplicates.id, flag.id));
        } catch (err) {
          result.failed++;
          result.errors.push(`Failed to merge ${flag.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      }
    }

    // Batch audit entry
    try {
      await db.insert(adminAuditLog).values({
        userId: session.user.id,
        userEmail: session.user.email,
        action: `batch_${action}_duplicates`,
        targetTable: 'potential_duplicates',
        rowsAffected: result.succeeded,
        metadata: { totalProcessed: result.processed, succeeded: result.succeeded, failed: result.failed },
      });
    } catch {}

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[BatchDuplicates] Error:', error);
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (error.message.startsWith('FORBIDDEN')) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to process batch action' }, { status: 500 });
  }
}

function pickKeeper(a: any, b: any): [any, any] {
  // Prefer valid email
  if (a.emailValidationStatus === 'valid' && b.emailValidationStatus !== 'valid') return [a, b];
  if (b.emailValidationStatus === 'valid' && a.emailValidationStatus !== 'valid') return [b, a];
  // Prefer enriched
  if (a.providerId && !b.providerId) return [a, b];
  if (b.providerId && !a.providerId) return [b, a];
  // Prefer most recently enriched
  const aDate = a.enrichedAt?.getTime() || 0;
  const bDate = b.enrichedAt?.getTime() || 0;
  return bDate > aDate ? [b, a] : [a, b];
}
