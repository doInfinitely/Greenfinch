import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { propertyPipeline, users } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId: clerkUserId } = await auth();
    
    if (!orgId || !clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(propertyPipeline)
      .where(
        and(
          eq(propertyPipeline.id, id),
          eq(propertyPipeline.clerkOrgId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Pipeline item not found' }, { status: 404 });
    }

    if (existing.status !== 'new') {
      return NextResponse.json({ 
        error: 'Can only claim properties in "New" stage. Contact an admin to reassign.' 
      }, { status: 403 });
    }

    if (existing.ownerId) {
      return NextResponse.json({ 
        error: 'This property already has an owner assigned.' 
      }, { status: 409 });
    }

    const [updated] = await db
      .update(propertyPipeline)
      .set({
        ownerId: user.id,
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
    console.error('Error claiming pipeline item:', error);
    return NextResponse.json({ error: 'Failed to claim pipeline item' }, { status: 500 });
  }
}
