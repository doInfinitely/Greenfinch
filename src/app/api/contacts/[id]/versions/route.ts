import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contactSnapshots, userContactVersions } from '@/lib/schema';
import { eq, desc, and } from 'drizzle-orm';
import { requireSession, getUserId } from '@/lib/auth';
import { apiSuccess, apiError, apiBadRequest, apiUnauthorized } from '@/lib/api-response';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const userId = await getUserId();
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return apiBadRequest('Invalid contact ID format');
    }

    const snapshots = await db
      .select()
      .from(contactSnapshots)
      .where(eq(contactSnapshots.contactId, id))
      .orderBy(desc(contactSnapshots.version));

    let userVersion = null;
    if (userId) {
      const [uv] = await db
        .select()
        .from(userContactVersions)
        .where(
          and(
            eq(userContactVersions.userId, userId),
            eq(userContactVersions.contactId, id)
          )
        )
        .limit(1);
      userVersion = uv || null;
    }

    const latestVersion = snapshots.length > 0 ? snapshots[0].version : 0;

    return apiSuccess({
      versions: snapshots,
      latestVersion,
      userViewing: userVersion?.viewingVersion || latestVersion,
      hasUnseenUpdate: userVersion?.hasUnseenUpdate || false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return apiUnauthorized();
    }
    return apiError('Failed to fetch contact versions');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const userId = await getUserId();
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return apiBadRequest('Invalid contact ID format');
    }
    if (!userId) {
      return apiUnauthorized();
    }

    const body = await request.json();
    const { version } = body;

    if (typeof version !== 'number' || version < 1) {
      return apiBadRequest('Invalid version number');
    }

    await db.insert(userContactVersions)
      .values({
        userId,
        contactId: id,
        viewingVersion: version,
        hasUnseenUpdate: false,
      })
      .onConflictDoUpdate({
        target: [userContactVersions.userId, userContactVersions.contactId],
        set: {
          viewingVersion: version,
          hasUnseenUpdate: false,
          updatedAt: new Date(),
        },
      });

    return apiSuccess({ viewingVersion: version });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return apiUnauthorized();
    }
    return apiError('Failed to update viewing version');
  }
}
