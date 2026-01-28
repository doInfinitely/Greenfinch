import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { enrichPersonPDL } from '@/lib/pdl';
import { lookupPerson as enrichLayerLookup, lookupWorkEmail } from '@/lib/enrichlayer';
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

    console.log('[Compare Person] Starting comparison for:', { firstName, lastName, domain });
    console.log('[Compare Person] PDL API Key configured:', !!process.env.PEOPLEDATALABS_API_KEY);
    console.log('[Compare Person] EnrichLayer API Key configured:', !!process.env.ENRICHLAYER_API_KEY);
    console.log('[Compare Person] Hunter API Key configured:', !!process.env.HUNTER_API_KEY);

    if (process.env.PEOPLEDATALABS_API_KEY) {
      // PDL Enrich API (strict matching)
      promises.push(
        (async () => {
          const pdlStart = Date.now();
          try {
            const result = await enrichPersonPDL(
              firstName,
              lastName || '',
              domain || '',
              { location, useSearch: false }
            );
            results.pdlEnrich = {
              provider: 'PDL Enrich (Strict)',
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
              error: result.found ? undefined : 'No exact match found (strict matching requires first+last+company)',
              latency: Date.now() - pdlStart,
              raw: result.raw,
            };
          } catch (error: any) {
            results.pdlEnrich = {
              provider: 'PDL Enrich (Strict)',
              success: false,
              error: error.message,
              latency: Date.now() - pdlStart,
            };
          }
        })()
      );
      
      // PDL Search API (relaxed matching)
      promises.push(
        (async () => {
          const pdlStart = Date.now();
          try {
            const result = await enrichPersonPDL(
              firstName,
              lastName || '',
              domain || '',
              { location, useSearch: true }
            );
            results.pdlSearch = {
              provider: 'PDL Search (Relaxed)',
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
              error: result.found ? undefined : 'No results found in PDL database',
              latency: Date.now() - pdlStart,
              raw: result.raw,
            };
          } catch (error: any) {
            results.pdlSearch = {
              provider: 'PDL Search (Relaxed)',
              success: false,
              error: error.message,
              latency: Date.now() - pdlStart,
            };
          }
        })()
      );
    }

    if (process.env.ENRICHLAYER_API_KEY) {
      // EnrichLayer Person Lookup (finds LinkedIn URL and basic info)
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
              provider: 'EnrichLayer Person Lookup',
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
            
            // If we got a LinkedIn URL, also call the work email endpoint
            if (result.success && result.linkedinUrl) {
              const workEmailStart = Date.now();
              try {
                const workEmailResult = await lookupWorkEmail(result.linkedinUrl, {
                  validate: true,
                  expectedDomain: domain || undefined,
                });
                results.enrichlayerWorkEmail = {
                  provider: 'EnrichLayer Work Email',
                  success: workEmailResult.success,
                  data: workEmailResult.success ? {
                    email: workEmailResult.email,
                    linkedinUrl: result.linkedinUrl,
                    status: workEmailResult.status,
                  } : null,
                  latency: Date.now() - workEmailStart,
                  error: workEmailResult.error,
                };
              } catch (workEmailError: any) {
                results.enrichlayerWorkEmail = {
                  provider: 'EnrichLayer Work Email',
                  success: false,
                  error: workEmailError.message,
                  latency: Date.now() - workEmailStart,
                };
              }
            }
          } catch (error: any) {
            results.enrichlayer = {
              provider: 'EnrichLayer Person Lookup',
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
