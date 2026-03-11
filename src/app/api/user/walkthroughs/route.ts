import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import type { WalkthroughState } from '@/lib/walkthroughs/types';

const DEFAULT_STATE: WalkthroughState = {
  completedTours: [],
  dismissedTooltips: [],
  skippedAll: false,
};

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { walkthroughState: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user.walkthroughState ?? DEFAULT_STATE);
  } catch (error) {
    console.error('[API] Error fetching walkthrough state:', error);
    return NextResponse.json({ error: 'Failed to fetch walkthrough state' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { completeTour, dismissTooltip, skipAll, resetAll } = body as {
      completeTour?: string;
      dismissTooltip?: string;
      skipAll?: boolean;
      resetAll?: boolean;
    };

    // Fetch current state
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { walkthroughState: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const state: WalkthroughState = (user.walkthroughState as WalkthroughState) ?? { ...DEFAULT_STATE };

    if (resetAll) {
      const resetState: WalkthroughState = { completedTours: [], dismissedTooltips: [], skippedAll: false };
      await db
        .update(users)
        .set({ walkthroughState: resetState, updatedAt: new Date() })
        .where(eq(users.id, session.user.id));
      return NextResponse.json(resetState);
    }

    if (completeTour && !state.completedTours.includes(completeTour)) {
      state.completedTours = [...state.completedTours, completeTour];
    }

    if (dismissTooltip && !state.dismissedTooltips.includes(dismissTooltip)) {
      state.dismissedTooltips = [...state.dismissedTooltips, dismissTooltip];
    }

    if (skipAll === true) {
      state.skippedAll = true;
    }

    await db
      .update(users)
      .set({ walkthroughState: state, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));

    return NextResponse.json(state);
  } catch (error) {
    console.error('[API] Error updating walkthrough state:', error);
    return NextResponse.json({ error: 'Failed to update walkthrough state' }, { status: 500 });
  }
}
