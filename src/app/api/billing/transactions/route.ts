import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { creditTransactions } from '@/lib/schema';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { isAdmin } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);
    const action = url.searchParams.get('action');
    const type = url.searchParams.get('type');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const conditions = [eq(creditTransactions.clerkOrgId, orgId)];
    if (action) conditions.push(eq(creditTransactions.action, action));
    if (type) conditions.push(eq(creditTransactions.type, type));
    if (from) conditions.push(gte(creditTransactions.createdAt, new Date(from)));
    if (to) conditions.push(lte(creditTransactions.createdAt, new Date(to)));

    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(creditTransactions)
        .where(where)
        .orderBy(desc(creditTransactions.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(creditTransactions)
        .where(where),
    ]);

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('[Billing] Transactions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
