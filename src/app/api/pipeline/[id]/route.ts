import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, PIPELINE_STATUSES, type PipelineStatus } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await auth();
    
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !PIPELINE_STATUSES.includes(status as PipelineStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(propertyPipeline)
      .where(
        and(
          eq(propertyPipeline.id, id),
          eq(propertyPipeline.clerkOrgId, orgId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Pipeline item not found' }, { status: 404 });
    }

    const [updated] = await db
      .update(propertyPipeline)
      .set({
        status: status as PipelineStatus,
        statusChangedAt: new Date(),
      })
      .where(
        and(
          eq(propertyPipeline.id, id),
          eq(propertyPipeline.clerkOrgId, orgId)
        )
      )
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating pipeline item:', error);
    return NextResponse.json({ error: 'Failed to update pipeline item' }, { status: 500 });
  }
}
