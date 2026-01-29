import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { enrichPersonPDL } from '@/lib/pdl';
import { lookupPerson as enrichLayerLookup, lookupWorkEmail } from '@/lib/enrichlayer';
import { findEmail as hunterFindEmail } from '@/lib/hunter';
import { enrichPersonApollo } from '@/lib/apollo';
import { findEmailByName as findymailSearch } from '@/lib/findymail';

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
    console.log('[Compare Person] Apollo API Key configured:', !!process.env.APOLLO_API_KEY);
    console.log('[Compare Person] Findymail API Key configured:', !!process.env.FINDYMAIL_API_KEY);

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
            // Add 500ms delay to avoid rate limits
            if (result.success && result.linkedinUrl) {
              await new Promise(resolve => setTimeout(resolve, 500));
              const workEmailStart = Date.now();
              try {
                const workEmailResult = await lookupWorkEmail(result.linkedinUrl, {
                  validate: true,
                  expectedDomain: domain || undefined,
                });
                results.enrichlayerWorkEmail = {
                  provider: 'EnrichLayer Work Email',
                  success: workEmailResult.success,
                  data: workEmailResult.email ? {
                    email: workEmailResult.email,
                    linkedinUrl: result.linkedinUrl,
                    status: workEmailResult.status,
                  } : null,
                  latency: Date.now() - workEmailStart,
                  error: workEmailResult.error,
                  status: workEmailResult.status,
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

    if (process.env.APOLLO_API_KEY && lastName) {
      promises.push(
        (async () => {
          const apolloStart = Date.now();
          try {
            const result = await enrichPersonApollo(firstName, lastName, domain || undefined);
            results.apollo = {
              provider: 'Apollo.io',
              success: result.found,
              data: result.found ? {
                fullName: result.fullName,
                firstName: result.firstName,
                lastName: result.lastName,
                title: result.title,
                email: result.email,
                phone: result.phone,
                company: result.company,
                companyDomain: result.companyDomain,
                linkedinUrl: result.linkedinUrl,
                location: result.location,
                confidence: null,
                domainMatch: domain ? result.companyDomain === domain : null,
                seniority: result.seniority,
                emailStatus: result.emailStatus,
              } : null,
              latency: Date.now() - apolloStart,
              error: result.found ? undefined : result.error || 'No match found',
              raw: result.raw,
            };
          } catch (error: any) {
            results.apollo = {
              provider: 'Apollo.io',
              success: false,
              error: error.message,
              latency: Date.now() - apolloStart,
            };
          }
        })()
      );
    }

    if (process.env.FINDYMAIL_API_KEY && domain && lastName) {
      promises.push(
        (async () => {
          const findymailStart = Date.now();
          try {
            const result = await findymailSearch(firstName, lastName, domain);
            results.findymail = {
              provider: 'Findymail',
              success: result.found,
              data: result.found ? {
                fullName: result.fullName,
                firstName: result.firstName,
                lastName: result.lastName,
                title: result.title,
                email: result.email,
                phone: result.phone,
                company: null,
                companyDomain: domain,
                linkedinUrl: result.linkedinUrl,
                location: null,
                confidence: null,
                domainMatch: true,
              } : null,
              latency: Date.now() - findymailStart,
              error: result.found ? undefined : result.error || 'No email found',
              raw: result.raw,
            };
          } catch (error: any) {
            results.findymail = {
              provider: 'Findymail',
              success: false,
              error: error.message,
              latency: Date.now() - findymailStart,
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
