import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { supportTickets, users } from '@/lib/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { INTERNAL_ORG_SLUG } from '@/lib/permissions';

async function requireAdminAccess() {
  const authData = await auth();
  if (!authData.userId || !authData.orgId) return null;

  // Only Greenfinch internal members can access
  if (authData.orgSlug !== INTERNAL_ORG_SLUG) return null;

  const session = await getSession();
  if (!session) return null;

  return { authData, session };
}

export async function GET() {
  try {
    const access = await requireAdminAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tickets = await db
      .select({
        id: supportTickets.id,
        clerkOrgId: supportTickets.clerkOrgId,
        userId: supportTickets.userId,
        subject: supportTickets.subject,
        transcript: supportTickets.transcript,
        userSummary: supportTickets.userSummary,
        aiSummary: supportTickets.aiSummary,
        status: supportTickets.status,
        priority: supportTickets.priority,
        assignedTo: supportTickets.assignedTo,
        resolution: supportTickets.resolution,
        resolvedAt: supportTickets.resolvedAt,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
        userName: sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
        userEmail: users.email,
      })
      .from(supportTickets)
      .leftJoin(users, eq(users.id, supportTickets.userId))
      .orderBy(desc(supportTickets.createdAt));

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('[AdminSupportTickets] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAdminAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { ticketId, status, resolution, assignedTo, priority } = body as {
      ticketId: string;
      status?: string;
      resolution?: string;
      assignedTo?: string | null;
      priority?: string;
    };

    if (!ticketId) {
      return NextResponse.json({ error: 'Missing ticketId' }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (resolution !== undefined) updates.resolution = resolution;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (priority) updates.priority = priority;

    if (status === 'resolved') {
      updates.resolvedAt = new Date();
    }

    const [updated] = await db
      .update(supportTickets)
      .set(updates)
      .where(eq(supportTickets.id, ticketId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    console.error('[AdminSupportTickets] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
