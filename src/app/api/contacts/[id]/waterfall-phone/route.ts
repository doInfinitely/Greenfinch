import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichPersonPDL } from '@/lib/pdl';
import { findPhoneByLinkedIn } from '@/lib/findymail';
import { findPhoneByName as hunterFindPhone } from '@/lib/hunter';
import { enrichLinkedInProfile } from '@/lib/enrichlayer';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { auth } from '@clerk/nextjs/server';
import { requireCredits } from '@/lib/credit-guard';
import { InsufficientCreditsError } from '@/lib/credits';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { apiSuccess, apiError, apiNotFound, apiBadRequest, apiUnauthorized } from '@/lib/api-response';
import { normalizePhoneWithExtension, normalizePhoneNumber } from '@/lib/phone-format';
import { trackCostFireAndForget } from '@/lib/cost-tracker';

const checkRateLimit = rateLimitMiddleware(20, 60);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseNameParts(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

interface PhoneWaterfallStep {
  source: string;
  phones: Array<{ number: string; label: string }>;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

interface CollectedPhone {
  normalized: string;
  raw: string;
  label: string;
  source: string;
  extension?: string | null;
}

function deduplicatePhones(phones: CollectedPhone[]): CollectedPhone[] {
  const seen = new Set<string>();
  const result: CollectedPhone[] = [];
  for (const p of phones) {
    const key = p.normalized.replace(/\D/g, '');
    if (!seen.has(key) && key.length >= 7) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateResponse = await checkRateLimit(request);
    if (rateResponse) return rateResponse;

    await requireSession();
    await requireAdminAccess();
    const { orgId } = await auth();

    const { id } = await params;

    await requireCredits('phone_lookup', 'contact', id);

    if (!id || !UUID_REGEX.test(id)) {
      return apiBadRequest('Invalid contact ID format');
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return apiNotFound('Contact not found');
    }

    if (!contact.fullName) {
      return apiBadRequest('Contact has no name');
    }

    const { firstName, lastName } = parseNameParts(contact.fullName);
    const steps: PhoneWaterfallStep[] = [];
    const allPhones: CollectedPhone[] = [];

    console.log(`[WaterfallPhone] Starting all-provider phone lookup for: ${contact.fullName} (${id})`);
    console.log(`[WaterfallPhone] Context: linkedin=${contact.linkedinUrl || 'none'}, email=${contact.email || 'none'}, domain=${contact.companyDomain || 'none'}`);

    const canRunFindymail = !!contact.linkedinUrl;
    const canRunPDL = !!lastName && !!(contact.companyDomain || contact.email || contact.linkedinUrl);
    const canRunHunter = !!firstName && !!lastName && !!contact.companyDomain;
    const canRunEnrichLayer = !!contact.linkedinUrl;

    const findymailPromise = canRunFindymail
      ? (async (): Promise<PhoneWaterfallStep> => {
          try {
            const result = await findPhoneByLinkedIn(contact.linkedinUrl!);
            trackCostFireAndForget({
              provider: 'findymail',
              endpoint: 'search/phone',
              entityType: 'contact',
              entityId: id,
              clerkOrgId: orgId || undefined,
              success: result.found,
              metadata: { found: result.found },
            });
            if (result.found && result.phone) {
              const norm = normalizePhoneNumber(result.phone) || result.phone;
              allPhones.push({ normalized: norm, raw: result.phone, label: 'mobile', source: 'findymail' });
              return { source: 'findymail', phones: [{ number: result.phone, label: 'mobile' }] };
            }
            return { source: 'findymail', phones: [] };
          } catch (err: any) {
            console.warn(`[WaterfallPhone] Findymail error:`, err.message);
            return { source: 'findymail', phones: [], error: err.message };
          }
        })()
      : Promise.resolve({ source: 'findymail', phones: [], skipped: true, skipReason: 'no LinkedIn URL' } as PhoneWaterfallStep);

    const pdlPromise = canRunPDL
      ? (async (): Promise<PhoneWaterfallStep> => {
          try {
            const result = await enrichPersonPDL(firstName, lastName, contact.companyDomain || '', {
              email: contact.email || undefined,
              linkedinUrl: contact.linkedinUrl || undefined,
              clerkOrgId: orgId || undefined,
            });
            trackCostFireAndForget({
              provider: 'pdl',
              endpoint: 'person-phone',
              entityType: 'contact',
              entityId: id,
              clerkOrgId: orgId || undefined,
              success: !!result?.found,
              metadata: { found: !!result?.found, hasPhone: !!result?.mobilePhone, phoneCount: result?.phonesJson?.length || 0 },
            });
            const foundPhones: Array<{ number: string; label: string }> = [];
            if (result?.found) {
              if (result.mobilePhone) {
                const norm = normalizePhoneNumber(result.mobilePhone) || result.mobilePhone;
                allPhones.push({ normalized: norm, raw: result.mobilePhone, label: 'mobile', source: 'pdl' });
                foundPhones.push({ number: result.mobilePhone, label: 'mobile' });
              }
              const phoneNumbers = result.phonesJson as any[] | null;
              if (phoneNumbers && Array.isArray(phoneNumbers)) {
                const workPhone = phoneNumbers.find((p: any) => p.type === 'work' || p.type === 'direct');
                if (workPhone?.number) {
                  const norm = normalizePhoneNumber(workPhone.number) || workPhone.number;
                  allPhones.push({ normalized: norm, raw: workPhone.number, label: 'work', source: 'pdl' });
                  foundPhones.push({ number: workPhone.number, label: 'work' });
                }
              }
            }
            return { source: 'pdl', phones: foundPhones };
          } catch (err: any) {
            console.warn(`[WaterfallPhone] PDL error:`, err.message);
            return { source: 'pdl', phones: [], error: err.message };
          }
        })()
      : Promise.resolve({ source: 'pdl', phones: [], skipped: true, skipReason: 'insufficient identifiers' } as PhoneWaterfallStep);

    const hunterPromise = canRunHunter
      ? (async (): Promise<PhoneWaterfallStep> => {
          try {
            const result = await hunterFindPhone(firstName, lastName, contact.companyDomain!);
            trackCostFireAndForget({
              provider: 'hunter',
              endpoint: 'email-finder-phone',
              entityType: 'contact',
              entityId: id,
              clerkOrgId: orgId || undefined,
              success: result.found,
              metadata: { found: result.found },
            });
            if (result.found && result.phone) {
              const norm = normalizePhoneNumber(result.phone) || result.phone;
              allPhones.push({ normalized: norm, raw: result.phone, label: 'direct_work', source: 'hunter' });
              return { source: 'hunter', phones: [{ number: result.phone, label: 'direct_work' }] };
            }
            return { source: 'hunter', phones: [] };
          } catch (err: any) {
            console.warn(`[WaterfallPhone] Hunter error:`, err.message);
            return { source: 'hunter', phones: [], error: err.message };
          }
        })()
      : Promise.resolve({ source: 'hunter', phones: [], skipped: true, skipReason: !lastName ? 'no last name' : 'no company domain' } as PhoneWaterfallStep);

    const enrichLayerPromise = canRunEnrichLayer
      ? (async (): Promise<PhoneWaterfallStep> => {
          try {
            const result = await enrichLinkedInProfile(contact.linkedinUrl!, {
              includePhone: true,
              includeEmail: false,
            });
            trackCostFireAndForget({
              provider: 'enrichlayer',
              endpoint: 'profile-phone',
              entityType: 'contact',
              entityId: id,
              clerkOrgId: orgId || undefined,
              success: result.success,
              metadata: { found: !!result.phone },
            });
            if (result.success && result.phone) {
              const label = result.personalPhone ? 'personal' : 'mobile';
              const norm = normalizePhoneNumber(result.phone) || result.phone;
              allPhones.push({ normalized: norm, raw: result.phone, label, source: 'enrichlayer' });
              return { source: 'enrichlayer', phones: [{ number: result.phone, label }] };
            }
            return { source: 'enrichlayer', phones: [], error: result.error || undefined };
          } catch (err: any) {
            console.warn(`[WaterfallPhone] EnrichLayer error:`, err.message);
            return { source: 'enrichlayer', phones: [], error: err.message };
          }
        })()
      : Promise.resolve({ source: 'enrichlayer', phones: [], skipped: true, skipReason: 'no LinkedIn URL' } as PhoneWaterfallStep);

    const [findymailStep, pdlStep, hunterStep, enrichLayerStep] = await Promise.all([
      findymailPromise, pdlPromise, hunterPromise, enrichLayerPromise,
    ]);
    steps.push(findymailStep, pdlStep, hunterStep, enrichLayerStep);

    const uniquePhones = deduplicatePhones(allPhones);

    const stepsLog = steps.map(s =>
      s.skipped ? `${s.source}: skipped (${s.skipReason})` :
      s.error ? `${s.source}: error (${s.error})` :
      s.phones.length > 0 ? `${s.source}: FOUND ${s.phones.map(p => p.number).join(', ')}` :
      `${s.source}: no phone`
    ).join(' | ');
    console.log(`[WaterfallPhone] All providers complete: ${stepsLog}`);
    console.log(`[WaterfallPhone] Total unique phones found: ${uniquePhones.length}`);

    if (uniquePhones.length > 0) {
      const primary = uniquePhones[0];
      const { normalized, extension } = normalizePhoneWithExtension(primary.raw);

      const existingPhones = new Set<string>();
      if (contact.phone) {
        const existingNorm = normalizePhoneNumber(contact.phone);
        if (existingNorm) existingPhones.add(existingNorm.replace(/\D/g, ''));
      }
      if (contact.enrichmentPhoneWork) {
        const existingNorm = normalizePhoneNumber(contact.enrichmentPhoneWork);
        if (existingNorm) existingPhones.add(existingNorm.replace(/\D/g, ''));
      }
      if (contact.enrichmentPhonePersonal) {
        const existingNorm = normalizePhoneNumber(contact.enrichmentPhonePersonal);
        if (existingNorm) existingPhones.add(existingNorm.replace(/\D/g, ''));
      }

      const mobilePhone = uniquePhones.find(p => p.label === 'mobile' || p.label === 'personal');
      const workPhone = uniquePhones.find(p => p.label === 'work' || p.label === 'direct_work');

      const updateData: Record<string, any> = {
        phone: normalized || primary.raw,
        normalizedPhone: normalized || primary.raw,
        phoneSource: primary.source,
        phoneLabel: primary.label,
        phoneExtension: extension || null,
        enrichedAt: new Date(),
        updatedAt: new Date(),
      };

      if (workPhone) {
        const workNorm = normalizePhoneNumber(workPhone.raw);
        updateData.enrichmentPhoneWork = workNorm || workPhone.raw;
      }

      if (mobilePhone && mobilePhone !== primary) {
        const mobileNorm = normalizePhoneNumber(mobilePhone.raw);
        updateData.enrichmentPhonePersonal = mobileNorm || mobilePhone.raw;
      }

      await db.update(contacts)
        .set(updateData)
        .where(eq(contacts.id, id));

      const newCount = uniquePhones.filter(p => !existingPhones.has(p.normalized.replace(/\D/g, ''))).length;
      console.log(`[WaterfallPhone] Saved ${uniquePhones.length} phone(s) for ${contact.fullName} (${newCount} new). Primary: ${primary.source}`);

      return apiSuccess({
        phone: normalized || primary.raw,
        extension: extension || null,
        source: primary.source,
        label: primary.label,
        allPhones: uniquePhones.map(p => ({
          number: normalizePhoneNumber(p.raw) || p.raw,
          label: p.label,
          source: p.source,
        })),
        totalFound: uniquePhones.length,
        newNumbers: newCount,
        steps,
        message: uniquePhones.length === 1
          ? `Phone found via ${primary.source}`
          : `${uniquePhones.length} phone numbers found from ${[...new Set(uniquePhones.map(p => p.source))].join(', ')}`,
      });
    }

    console.log(`[WaterfallPhone] No phone found after all providers for ${contact.fullName}`);

    return apiSuccess({
      phone: null,
      allPhones: [],
      totalFound: 0,
      steps,
      message: 'No phone number found',
    });
  } catch (error) {
    console.error('[WaterfallPhone] API error:', error);
    
    if (error instanceof InsufficientCreditsError) {
      return apiError('Insufficient credits', { status: 402, meta: { required: error.required, available: error.available } });
    }
    if (error instanceof Error) {
      if (error.message === 'UNAUTHORIZED') {
        return apiUnauthorized();
      }
      if (error.message.startsWith('FORBIDDEN')) {
        return apiError('Admin access required', { status: 403 });
      }
    }

    return apiError('Failed to trigger phone lookup');
  }
}
