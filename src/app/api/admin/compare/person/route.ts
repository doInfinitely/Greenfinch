import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { enrichPersonPDL } from '@/lib/pdl';
import { lookupPerson as enrichLayerLookup } from '@/lib/enrichlayer';
import { findEmail as hunterFindEmail } from '@/lib/hunter';

export async function POST(request: NextRequest) {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { firstName, lastName, domain, title, location } = body;

    if (!firstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 });
    }

    const results: Record<string, any> = {};
    const startTime = Date.now();

    const promises: Promise<void>[] = [];

    if (process.env.PEOPLEDATALABS_API_KEY) {
      promises.push(
        (async () => {
          const pdlStart = Date.now();
          try {
            const result = await enrichPersonPDL(
              firstName,
              lastName || '',
              domain || '',
              { location }
            );
            results.pdl = {
              provider: 'People Data Labs',
              success: result.found,
              data: result.found ? {
                fullName: result.fullName,
                firstName: result.firstName,
                lastName: result.lastName,
                title: result.title,
                email: result.email,
                phone: null,
                company: result.companyName,
                companyDomain: result.companyDomain,
                linkedinUrl: result.linkedinUrl,
                location: result.location,
                confidence: result.confidence,
                domainMatch: result.domainMatch,
              } : null,
              latency: Date.now() - pdlStart,
              raw: result.raw,
            };
          } catch (error: any) {
            results.pdl = {
              provider: 'People Data Labs',
              success: false,
              error: error.message,
              latency: Date.now() - pdlStart,
            };
          }
        })()
      );
    }

    if (process.env.ENRICHLAYER_API_KEY) {
      promises.push(
        (async () => {
          const elStart = Date.now();
          try {
            const result = await enrichLayerLookup({
              firstName,
              lastName,
              companyDomain: domain,
              title,
              location,
            });
            results.enrichlayer = {
              provider: 'EnrichLayer',
              success: result.success,
              data: result.success ? {
                fullName: result.fullName,
                firstName: result.firstName,
                lastName: result.lastName,
                title: result.title,
                email: result.email,
                phone: result.phone,
                company: result.company,
                companyDomain: domain,
                linkedinUrl: result.linkedinUrl,
                location: result.location,
                confidence: null,
                domainMatch: null,
              } : null,
              latency: Date.now() - elStart,
              raw: result.rawResponse,
              error: result.error,
            };
          } catch (error: any) {
            results.enrichlayer = {
              provider: 'EnrichLayer',
              success: false,
              error: error.message,
              latency: Date.now() - elStart,
            };
          }
        })()
      );
    }

    if (process.env.HUNTER_API_KEY && domain && lastName) {
      promises.push(
        (async () => {
          const hunterStart = Date.now();
          try {
            const result = await hunterFindEmail(firstName, lastName, domain);
            results.hunter = {
              provider: 'Hunter.io',
              success: result.email !== null,
              data: result.email ? {
                fullName: `${firstName} ${lastName}`,
                firstName,
                lastName,
                title: null,
                email: result.email,
                phone: null,
                company: null,
                companyDomain: domain,
                linkedinUrl: null,
                location: null,
                confidence: result.confidence,
                domainMatch: true,
              } : null,
              latency: Date.now() - hunterStart,
              error: result.status === 'not_found' ? 'Email not found' : null,
            };
          } catch (error: any) {
            results.hunter = {
              provider: 'Hunter.io',
              success: false,
              error: error.message,
              latency: Date.now() - hunterStart,
            };
          }
        })()
      );
    }

    await Promise.all(promises);

    return NextResponse.json({
      input: { firstName, lastName, domain, title, location },
      results,
      totalLatency: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[Compare Person] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
