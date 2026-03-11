import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getOrgBalance } from '@/lib/credits';

export async function GET() {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const balance = await getOrgBalance(orgId);
    return NextResponse.json({ success: true, data: balance });
  } catch (error) {
    console.error('[Billing] Balance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
