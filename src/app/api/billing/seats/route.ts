import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAdmin } from '@/lib/permissions';
import { getOrgSeatInfo, updateSeatCount, previewSeatChange } from '@/lib/seat-management';

export async function GET() {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const seatInfo = await getOrgSeatInfo(orgId);
    return NextResponse.json({ success: true, data: seatInfo });
  } catch (error) {
    console.error('[Billing] Seats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, orgRole } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(orgRole)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { action, count } = await request.json();

    if (!action || !['add', 'remove', 'preview'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const seatInfo = await getOrgSeatInfo(orgId);
    const delta = action === 'remove' ? -(count || 1) : (count || 1);
    const newCount = seatInfo.seatCount + delta;

    if (newCount < 1) {
      return NextResponse.json({ error: 'Must have at least 1 seat' }, { status: 400 });
    }

    if (action === 'remove' && newCount < seatInfo.totalUsed) {
      return NextResponse.json(
        { error: `Cannot reduce below ${seatInfo.totalUsed} seats (currently in use)` },
        { status: 400 }
      );
    }

    if (action === 'preview') {
      const preview = await previewSeatChange(orgId, newCount);
      return NextResponse.json({ success: true, data: { preview, newCount } });
    }

    await updateSeatCount(orgId, newCount);
    const updated = await getOrgSeatInfo(orgId);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Billing] Seat update error:', error);
    return NextResponse.json({ error: 'Failed to update seats' }, { status: 500 });
  }
}
