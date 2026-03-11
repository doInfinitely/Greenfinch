import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { type OnboardingProgress, allStepsComplete } from '@/lib/onboarding';

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let progress: OnboardingProgress = (user.onboardingProgress as OnboardingProgress) || {};

    // For existing users who completed settings before onboarding existed,
    // pre-fill services + territory as done
    if (user.settingsCompleted && !progress.services) {
      progress = { ...progress, services: true, territory: true };
    }

    return NextResponse.json({
      onboardingProgress: progress,
      settingsCompleted: user.settingsCompleted,
      territoryZipCodes: user.territoryZipCodes || [],
    });
  } catch (error) {
    console.error('[API] Error fetching onboarding progress:', error);
    return NextResponse.json({ error: 'Failed to fetch onboarding progress' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { step, zipCodes } = body;

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const progress: OnboardingProgress = (user.onboardingProgress as OnboardingProgress) || {};

    if (step === 'skip') {
      progress.skippedAt = new Date().toISOString();
      await db
        .update(users)
        .set({
          onboardingProgress: progress,
          settingsCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, session.user.id));
    } else if (step === 'territory' && zipCodes) {
      progress.territory = true;
      await db
        .update(users)
        .set({
          onboardingProgress: progress,
          territoryZipCodes: zipCodes,
          settingsCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, session.user.id));
    } else {
      progress[step as keyof OnboardingProgress] = true as never;

      const updateData: Record<string, unknown> = {
        onboardingProgress: progress,
        updatedAt: new Date(),
      };

      // If all 5 steps are done, set completedAt
      if (allStepsComplete(progress) && !progress.completedAt) {
        progress.completedAt = new Date().toISOString();
        updateData.onboardingProgress = progress;
      }

      await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, session.user.id));
    }

    return NextResponse.json({ success: true, onboardingProgress: progress });
  } catch (error) {
    console.error('[API] Error updating onboarding progress:', error);
    return NextResponse.json({ error: 'Failed to update onboarding progress' }, { status: 500 });
  }
}
