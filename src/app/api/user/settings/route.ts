import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, serviceProviders } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import type { OnboardingProgress } from '@/lib/onboarding';

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

    return NextResponse.json({
      companyName: user.companyName,
      companyDomain: user.companyDomain,
      selectedServices: user.selectedServices || [],
      settingsCompleted: user.settingsCompleted,
    });
  } catch (error) {
    console.error('[API] Error fetching user settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { companyName, companyDomain, selectedServices } = body;

    // Read current onboarding progress and mark services step
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });
    const progress: OnboardingProgress = (currentUser?.onboardingProgress as OnboardingProgress) || {};
    progress.services = true;

    // Update user settings
    await db
      .update(users)
      .set({
        companyName,
        companyDomain,
        selectedServices,
        settingsCompleted: true,
        onboardingProgress: progress,
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    // If company domain is provided, ensure service provider record exists
    if (companyDomain) {
      const normalizedDomain = companyDomain.toLowerCase().trim();
      
      // Check if service provider exists
      const existingProvider = await db.query.serviceProviders.findFirst({
        where: eq(serviceProviders.domain, normalizedDomain),
      });

      if (existingProvider) {
        // Update existing provider with services
        await db
          .update(serviceProviders)
          .set({
            name: companyName || existingProvider.name,
            servicesOffered: selectedServices,
            isUserCompany: true,
            updatedAt: new Date(),
          })
          .where(eq(serviceProviders.domain, normalizedDomain));
      } else {
        // Create new service provider
        await db.insert(serviceProviders).values({
          name: companyName || normalizedDomain,
          domain: normalizedDomain,
          servicesOffered: selectedServices,
          isUserCompany: true,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully',
    });
  } catch (error) {
    console.error('[API] Error saving user settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}
