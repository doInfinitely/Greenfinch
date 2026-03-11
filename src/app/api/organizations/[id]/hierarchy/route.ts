import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { resolveParentHierarchy } from '@/lib/organization-enrichment';
import { normalizeDomain } from '@/lib/normalization';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { parentOrgId, action } = body as { parentOrgId: string; action: 'link' | 'unlink' };

    if (!id) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (action === 'unlink') {
      await db.update(organizations)
        .set({
          parentOrgId: null,
          parentDomain: null,
          ultimateParentOrgId: null,
          ultimateParentDomain: null,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, id));

      return NextResponse.json({ success: true });
    }

    // action === 'link'
    if (!parentOrgId) {
      return NextResponse.json({ error: 'parentOrgId is required for link action' }, { status: 400 });
    }

    // No self-reference
    if (parentOrgId === id) {
      return NextResponse.json({ error: 'Cannot set an organization as its own parent' }, { status: 400 });
    }

    const parentOrg = await db.query.organizations.findFirst({
      where: eq(organizations.id, parentOrgId),
    });
    if (!parentOrg) {
      return NextResponse.json({ error: 'Parent organization not found' }, { status: 404 });
    }

    // BFS circular reference check: ensure id is not an ancestor of parentOrgId
    const visited = new Set<string>([id]);
    const queue = [parentOrgId];
    let circular = false;

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        circular = true;
        break;
      }
      visited.add(currentId);

      // Check if currentId has this org as a descendant (i.e., this org is already an ancestor of parentOrgId)
      const current = await db.query.organizations.findFirst({
        where: eq(organizations.id, currentId),
        columns: { parentOrgId: true },
      });
      if (current?.parentOrgId) {
        queue.push(current.parentOrgId);
      }
    }

    // Also check descendants of id to make sure parentOrgId isn't one of them
    const descendantQueue = [id];
    const descendantVisited = new Set<string>();
    while (descendantQueue.length > 0) {
      const currentId = descendantQueue.shift()!;
      if (descendantVisited.has(currentId)) continue;
      descendantVisited.add(currentId);

      const children = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.parentOrgId, currentId));

      for (const child of children) {
        if (child.id === parentOrgId) {
          circular = true;
          break;
        }
        descendantQueue.push(child.id);
      }
      if (circular) break;
    }

    if (circular) {
      return NextResponse.json({ error: 'Cannot create circular parent relationship' }, { status: 400 });
    }

    // Set parentOrgId and parentDomain
    const parentDomain = parentOrg.domain ? normalizeDomain(parentOrg.domain) : null;

    await db.update(organizations)
      .set({
        parentOrgId: parentOrgId,
        parentDomain: parentDomain,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id));

    // Resolve ultimate parent hierarchy
    if (parentDomain) {
      await resolveParentHierarchy(id, parentDomain);
    } else {
      // No domain — just set ultimate parent by walking chain
      let ultimateParentId = parentOrgId;
      const walkVisited = new Set<string>([id, parentOrgId]);
      for (let depth = 0; depth < 10; depth++) {
        const current = await db.query.organizations.findFirst({
          where: eq(organizations.id, ultimateParentId),
          columns: { parentOrgId: true },
        });
        if (!current?.parentOrgId || walkVisited.has(current.parentOrgId)) break;
        walkVisited.add(current.parentOrgId);
        ultimateParentId = current.parentOrgId;
      }

      if (ultimateParentId !== parentOrgId) {
        const ultimateParent = await db.query.organizations.findFirst({
          where: eq(organizations.id, ultimateParentId),
          columns: { domain: true },
        });
        await db.update(organizations)
          .set({
            ultimateParentOrgId: ultimateParentId,
            ultimateParentDomain: ultimateParent?.domain ? normalizeDomain(ultimateParent.domain) : null,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, id));
      }
    }

    // Fetch updated org to return
    const updatedOrg = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });

    return NextResponse.json({ success: true, organization: updatedOrg });
  } catch (error) {
    console.error('Error updating organization hierarchy:', error);
    return NextResponse.json(
      { error: 'Failed to update organization hierarchy' },
      { status: 500 }
    );
  }
}
