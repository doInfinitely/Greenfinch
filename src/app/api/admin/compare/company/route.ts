import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { enrichCompanyPDL } from '@/lib/pdl';
import { resolveCompanyByDomain, getCompanyProfile } from '@/lib/enrichlayer';
import { enrichCompanyByDomain as hunterEnrichCompany } from '@/lib/hunter';
import { enrichCompanyApollo } from '@/lib/apollo';

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
    const { domain } = body;

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
    }

    const normalizedDomain = domain.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    const results: Record<string, any> = {};
    const startTime = Date.now();

    const promises: Promise<void>[] = [];

    if (process.env.PEOPLEDATALABS_API_KEY) {
      promises.push(
        (async () => {
          const pdlStart = Date.now();
          try {
            const result = await enrichCompanyPDL(normalizedDomain);
            results.pdl = {
              provider: 'People Data Labs',
              success: result.found,
              data: result.found ? {
                name: result.displayName || result.name,
                description: result.description,
                industry: result.industry,
                category: null,
                employeeCount: result.employeeCount,
                employeeRange: result.employeeRange,
                foundedYear: result.foundedYear,
                city: result.city,
                state: result.state,
                country: result.country,
                location: [result.city, result.state, result.country].filter(Boolean).join(', '),
                website: result.website,
                linkedinUrl: result.linkedinUrl,
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
            const resolveResult = await resolveCompanyByDomain(normalizedDomain);
            if (resolveResult.success && resolveResult.linkedinUrl) {
              const profileResult = await getCompanyProfile(resolveResult.linkedinUrl);
              if (profileResult.success && profileResult.data) {
                const d = profileResult.data;
                const employeeRange = d.companySize 
                  ? `${d.companySize[0] || '?'}-${d.companySize[1] || '?'}` 
                  : null;
                results.enrichlayer = {
                  provider: 'EnrichLayer',
                  success: true,
                  data: {
                    name: d.name,
                    description: d.description,
                    industry: d.industry,
                    category: d.categories?.join(', ') || null,
                    employeeCount: d.companySize?.[0] || null,
                    employeeRange,
                    foundedYear: d.foundedYear,
                    city: d.headquarter?.city,
                    state: d.headquarter?.state,
                    country: d.headquarter?.country,
                    location: [d.headquarter?.city, d.headquarter?.state, d.headquarter?.country].filter(Boolean).join(', '),
                    website: d.website,
                    linkedinUrl: resolveResult.linkedinUrl,
                  },
                  latency: Date.now() - elStart,
                };
              } else {
                results.enrichlayer = {
                  provider: 'EnrichLayer',
                  success: false,
                  error: profileResult.error || 'Profile not found',
                  latency: Date.now() - elStart,
                };
              }
            } else {
              results.enrichlayer = {
                provider: 'EnrichLayer',
                success: false,
                error: resolveResult.error || 'Could not resolve domain',
                latency: Date.now() - elStart,
              };
            }
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

    if (process.env.HUNTER_API_KEY) {
      promises.push(
        (async () => {
          const hunterStart = Date.now();
          try {
            const result = await hunterEnrichCompany(normalizedDomain);
            if (result.success && result.data) {
              const d = result.data;
              results.hunter = {
                provider: 'Hunter.io',
                success: true,
                data: {
                  name: d.name,
                  description: d.description,
                  industry: d.industry,
                  category: d.tags?.join(', ') || null,
                  employeeCount: d.employees,
                  employeeRange: d.employeesRange,
                  foundedYear: d.foundedYear,
                  city: d.city,
                  state: d.state,
                  country: d.country,
                  location: [d.city, d.state, d.country].filter(Boolean).join(', '),
                  website: `https://${d.domain}`,
                  linkedinUrl: d.linkedinHandle ? `https://linkedin.com/company/${d.linkedinHandle}` : null,
                },
                latency: Date.now() - hunterStart,
                raw: result.data,
              };
            } else {
              results.hunter = {
                provider: 'Hunter.io',
                success: false,
                error: result.error || 'Company not found',
                latency: Date.now() - hunterStart,
              };
            }
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

    if (process.env.APOLLO_API_KEY) {
      promises.push(
        (async () => {
          const apolloStart = Date.now();
          try {
            const result = await enrichCompanyApollo(normalizedDomain);
            results.apollo = {
              provider: 'Apollo.io',
              success: result.found,
              data: result.found ? {
                name: result.name,
                description: result.description,
                industry: result.industry,
                category: result.keywords?.slice(0, 5).join(', ') || null,
                employeeCount: result.employeeCount,
                employeeRange: null,
                foundedYear: result.foundedYear,
                city: result.city,
                state: result.state,
                country: result.country,
                location: [result.city, result.state, result.country].filter(Boolean).join(', '),
                website: result.website,
                linkedinUrl: result.linkedinUrl,
                twitterUrl: result.twitterUrl,
                facebookUrl: result.facebookUrl,
                logoUrl: result.logoUrl,
                phone: result.phone,
                sicCodes: result.sicCodes,
                naicsCodes: result.naicsCodes,
              } : null,
              latency: Date.now() - apolloStart,
              error: result.found ? undefined : result.error,
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

    await Promise.all(promises);

    return NextResponse.json({
      input: { domain: normalizedDomain },
      results,
      totalLatency: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[Compare Company] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
