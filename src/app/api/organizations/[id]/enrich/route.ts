import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichOrganizationById } from '@/lib/organization-enrichment';
import { auth } from '@clerk/nextjs/server';
import { requireCredits } from '@/lib/credit-guard';
import { InsufficientCreditsError } from '@/lib/credits';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { orgId } = await auth();

    await requireCredits('org_enrich', 'organization', id);

    if (!id) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (!org.domain) {
      return NextResponse.json({ error: 'Organization has no domain to enrich' }, { status: 400 });
    }

    console.log(`[API] Manually enriching organization ${id} (${org.domain})`);
    
    const result = await enrichOrganizationById(id, { clerkOrgId: orgId || undefined });
    
    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Enrichment failed',
        orgId: result.orgId,
      }, { status: 422 });
    }

    const updatedOrg = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });

    return NextResponse.json({
      success: true,
      organization: updatedOrg,
      enrichedData: result.enrichedData,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: 'Insufficient credits', required: error.required, available: error.available },
        { status: 402 }
      );
    }
    console.error('Error enriching organization:', error);
    return NextResponse.json(
      { error: 'Failed to enrich organization' },
      { status: 500 }
    );
  }
}
