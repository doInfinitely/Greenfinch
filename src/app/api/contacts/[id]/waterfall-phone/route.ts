import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { enrichPersonPDL } from '@/lib/pdl';
import { findPhoneByLinkedIn } from '@/lib/findymail';
import { findPhoneByName as hunterFindPhone } from '@/lib/hunter';
import { enrichLinkedInProfile } from '@/lib/enrichlayer';
import { requireSession, requireAdminAccess } from '@/lib/auth';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { apiSuccess, apiError, apiNotFound, apiBadRequest, apiUnauthorized } from '@/lib/api-response';
import { normalizePhoneWithExtension } from '@/lib/phone-format';
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
  phone: string | null;
  label: string | null;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
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
    
    const { id } = await params;

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

    console.log(`[WaterfallPhone] Starting 4-step phone waterfall for: ${contact.fullName} (${id})`);
    console.log(`[WaterfallPhone] Context: linkedin=${contact.linkedinUrl || 'none'}, email=${contact.email || 'none'}, domain=${contact.companyDomain || 'none'}`);

    let foundPhone: string | null = null;
    let phoneSource: string | null = null;
    let phoneLabel: string | null = null;

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Findymail Phone Finder (requires LinkedIn URL)
    // ═══════════════════════════════════════════════════════════════
    if (contact.linkedinUrl) {
      console.log(`[WaterfallPhone] Step 1: Findymail phone finder via LinkedIn`);
      try {
        const findymailResult = await findPhoneByLinkedIn(contact.linkedinUrl);
        
        trackCostFireAndForget({
          provider: 'findymail',
          endpoint: 'search/phone',
          entityType: 'contact',
          entityId: id,
          success: findymailResult.found,
          metadata: { found: findymailResult.found },
        });

        if (findymailResult.found && findymailResult.phone) {
          foundPhone = findymailResult.phone;
          phoneSource = 'findymail_phone';
          phoneLabel = 'mobile';
          steps.push({ source: 'findymail', phone: foundPhone, label: 'mobile' });
          console.log(`[WaterfallPhone] Step 1 SUCCESS: Findymail phone found: ${foundPhone}`);
        } else {
          steps.push({ source: 'findymail', phone: null, label: null });
          console.log(`[WaterfallPhone] Step 1: Findymail — no phone found`);
        }
      } catch (err: any) {
        steps.push({ source: 'findymail', phone: null, label: null, error: err.message });
        console.warn(`[WaterfallPhone] Step 1 ERROR: Findymail phone finder failed:`, err.message);
      }
    } else {
      steps.push({ source: 'findymail', phone: null, label: null, skipped: true, skipReason: 'no LinkedIn URL' });
      console.log(`[WaterfallPhone] Step 1: Skipped — no LinkedIn URL`);
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: PDL Person Enrichment (requires name + domain or email)
    // ═══════════════════════════════════════════════════════════════
    if (!foundPhone) {
      const canRunPDL = lastName && (contact.companyDomain || contact.email || contact.linkedinUrl);
      if (canRunPDL) {
        console.log(`[WaterfallPhone] Step 2: PDL person enrichment for phone`);
        try {
          const pdlResult = await enrichPersonPDL(
            firstName,
            lastName,
            contact.companyDomain || '',
            {
              email: contact.email || undefined,
              linkedinUrl: contact.linkedinUrl || undefined,
            }
          );

          trackCostFireAndForget({
            provider: 'pdl',
            endpoint: 'person-phone',
            entityType: 'contact',
            entityId: id,
            success: !!pdlResult?.found,
            metadata: { found: !!pdlResult?.found, hasPhone: !!pdlResult?.mobilePhone },
          });

          if (pdlResult?.found && pdlResult.mobilePhone) {
            foundPhone = pdlResult.mobilePhone;
            phoneSource = 'pdl';
            phoneLabel = 'mobile';
            steps.push({ source: 'pdl', phone: foundPhone, label: 'mobile' });
            console.log(`[WaterfallPhone] Step 2 SUCCESS: PDL phone found: ${foundPhone}`);
          } else {
            steps.push({ source: 'pdl', phone: null, label: null });
            console.log(`[WaterfallPhone] Step 2: PDL — no phone available`);
          }
        } catch (err: any) {
          steps.push({ source: 'pdl', phone: null, label: null, error: err.message });
          console.warn(`[WaterfallPhone] Step 2 ERROR: PDL failed:`, err.message);
        }
      } else {
        steps.push({ source: 'pdl', phone: null, label: null, skipped: true, skipReason: 'insufficient identifiers' });
        console.log(`[WaterfallPhone] Step 2: Skipped — insufficient identifiers for PDL`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Hunter Email Finder (returns phone_number if available)
    // ═══════════════════════════════════════════════════════════════
    if (!foundPhone) {
      const canRunHunter = firstName && lastName && contact.companyDomain;
      if (canRunHunter) {
        console.log(`[WaterfallPhone] Step 3: Hunter email finder for phone`);
        try {
          const hunterResult = await hunterFindPhone(firstName, lastName, contact.companyDomain!);

          trackCostFireAndForget({
            provider: 'hunter',
            endpoint: 'email-finder-phone',
            entityType: 'contact',
            entityId: id,
            success: hunterResult.found,
            metadata: { found: hunterResult.found },
          });

          if (hunterResult.found && hunterResult.phone) {
            foundPhone = hunterResult.phone;
            phoneSource = 'hunter';
            phoneLabel = 'direct_work';
            steps.push({ source: 'hunter', phone: foundPhone, label: 'direct_work' });
            console.log(`[WaterfallPhone] Step 3 SUCCESS: Hunter phone found: ${foundPhone}`);
          } else {
            steps.push({ source: 'hunter', phone: null, label: null });
            console.log(`[WaterfallPhone] Step 3: Hunter — no phone available`);
          }
        } catch (err: any) {
          steps.push({ source: 'hunter', phone: null, label: null, error: err.message });
          console.warn(`[WaterfallPhone] Step 3 ERROR: Hunter failed:`, err.message);
        }
      } else {
        const reason = !lastName ? 'no last name' : 'no company domain';
        steps.push({ source: 'hunter', phone: null, label: null, skipped: true, skipReason: reason });
        console.log(`[WaterfallPhone] Step 3: Skipped — ${reason}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: EnrichLayer LinkedIn Profile (requires LinkedIn URL)
    // ═══════════════════════════════════════════════════════════════
    if (!foundPhone) {
      if (contact.linkedinUrl) {
        console.log(`[WaterfallPhone] Step 4: EnrichLayer LinkedIn profile for phone`);
        try {
          const enrichLayerResult = await enrichLinkedInProfile(contact.linkedinUrl, {
            includePhone: true,
            includeEmail: false,
          });

          trackCostFireAndForget({
            provider: 'enrichlayer',
            endpoint: 'profile-phone',
            entityType: 'contact',
            entityId: id,
            success: enrichLayerResult.success,
            metadata: { found: !!enrichLayerResult.phone },
          });

          if (enrichLayerResult.success && enrichLayerResult.phone) {
            foundPhone = enrichLayerResult.phone;
            phoneSource = 'enrichlayer';
            phoneLabel = enrichLayerResult.personalPhone ? 'personal' : 'mobile';
            steps.push({ source: 'enrichlayer', phone: foundPhone, label: phoneLabel });
            console.log(`[WaterfallPhone] Step 4 SUCCESS: EnrichLayer phone found: ${foundPhone}`);
          } else {
            steps.push({ source: 'enrichlayer', phone: null, label: null, error: enrichLayerResult.error || undefined });
            console.log(`[WaterfallPhone] Step 4: EnrichLayer — no phone available${enrichLayerResult.error ? ` (${enrichLayerResult.error})` : ''}`);
          }
        } catch (err: any) {
          steps.push({ source: 'enrichlayer', phone: null, label: null, error: err.message });
          console.warn(`[WaterfallPhone] Step 4 ERROR: EnrichLayer failed:`, err.message);
        }
      } else {
        steps.push({ source: 'enrichlayer', phone: null, label: null, skipped: true, skipReason: 'no LinkedIn URL' });
        console.log(`[WaterfallPhone] Step 4: Skipped — no LinkedIn URL`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // SAVE RESULT
    // ═══════════════════════════════════════════════════════════════
    const stepsLog = steps.map(s => 
      s.skipped ? `${s.source}: skipped (${s.skipReason})` :
      s.error ? `${s.source}: error (${s.error})` :
      s.phone ? `${s.source}: FOUND ${s.phone}` :
      `${s.source}: no phone`
    ).join(' → ');
    console.log(`[WaterfallPhone] Waterfall complete: ${stepsLog}`);

    if (foundPhone) {
      const { normalized, extension } = normalizePhoneWithExtension(foundPhone);

      await db.update(contacts)
        .set({
          phone: normalized || foundPhone,
          normalizedPhone: normalized || foundPhone,
          phoneSource: phoneSource,
          phoneLabel: phoneLabel,
          phoneExtension: extension || null,
          enrichedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id));

      console.log(`[WaterfallPhone] Saved phone for ${contact.fullName} via ${phoneSource}${extension ? ` ext ${extension}` : ''}`);

      return apiSuccess({
        phone: normalized || foundPhone,
        extension: extension || null,
        source: phoneSource,
        label: phoneLabel,
        steps,
        message: `Phone found via ${phoneSource}`,
      });
    }

    console.log(`[WaterfallPhone] No phone found after full waterfall for ${contact.fullName}`);

    return apiSuccess({
      phone: null,
      steps,
      message: 'No phone number found',
    });
  } catch (error) {
    console.error('[WaterfallPhone] API error:', error);
    
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
