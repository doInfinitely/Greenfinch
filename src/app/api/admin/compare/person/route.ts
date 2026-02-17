import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { enrichPersonPDL } from '@/lib/pdl';
import { findEmail as hunterFindEmail } from '@/lib/hunter';
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
    console.log('[Compare Person] PDL API Key configured:', !!(process.env.PDL_API_KEY || process.env.PEOPLEDATALABS_API_KEY));
    console.log('[Compare Person] Hunter API Key configured:', !!process.env.HUNTER_API_KEY);
    console.log('[Compare Person] Findymail API Key configured:', !!process.env.FINDYMAIL_API_KEY);

    if (process.env.PDL_API_KEY || process.env.PEOPLEDATALABS_API_KEY) {
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
