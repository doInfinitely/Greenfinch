// ============================================================================
// Phone Enrichment Waterfall
//
// Systematically discovers phone numbers for contacts using a priority
// waterfall:
//   1. Existing phone (from PDL or prior stages) — free
//   2. Findymail findPhoneByLinkedIn — uses existing subscription
//   3. Hunter findPhoneByName — uses existing subscription
//
// Results are cached per LinkedIn URL (30d TTL) to avoid re-fetching.
// ============================================================================

import { findPhoneByLinkedIn } from './findymail';
import { findPhoneByName } from './hunter';
import { cacheGet, cacheSet } from './redis';
import { trackCostFireAndForget } from './cost-tracker';

const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const NEGATIVE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days for negative results

export interface PhoneEnrichmentResult {
  found: boolean;
  phone: string | null;
  phones: Array<{ phone: string; type?: string; label?: string; source: string }>;
  source: 'existing' | 'findymail' | 'hunter' | null;
}

function buildCacheKey(linkedinUrl?: string | null, firstName?: string, lastName?: string, domain?: string): string {
  if (linkedinUrl) {
    return `phone-enrich:li:${linkedinUrl.toLowerCase().replace(/\/$/, '')}`;
  }
  if (firstName && lastName && domain) {
    return `phone-enrich:name:${firstName.toLowerCase()}|${lastName.toLowerCase()}|${domain.toLowerCase()}`;
  }
  return '';
}

/**
 * Run the phone enrichment waterfall for a contact.
 *
 * @param contact Contact details. At minimum needs linkedinUrl OR (firstName + lastName + domain).
 * @returns Phone enrichment result with discovered phones and their sources.
 */
export async function enrichPhone(contact: {
  existingPhone?: string | null;
  linkedinUrl?: string | null;
  firstName?: string;
  lastName?: string;
  domain?: string;
}): Promise<PhoneEnrichmentResult> {
  // Stage 1: Return existing phone immediately
  if (contact.existingPhone) {
    return {
      found: true,
      phone: contact.existingPhone,
      phones: [{ phone: contact.existingPhone, source: 'existing' }],
      source: 'existing',
    };
  }

  // Check cache
  const cacheKey = buildCacheKey(contact.linkedinUrl, contact.firstName, contact.lastName, contact.domain);
  if (cacheKey) {
    const cached = await cacheGet<PhoneEnrichmentResult>(cacheKey);
    if (cached) {
      console.log(`[PhoneEnrich] Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  const allPhones: Array<{ phone: string; type?: string; label?: string; source: string }> = [];

  // Stage 2: Findymail phone by LinkedIn URL
  if (contact.linkedinUrl) {
    try {
      const fmResult = await findPhoneByLinkedIn(contact.linkedinUrl);
      if (fmResult.found && fmResult.phone) {
        allPhones.push({ phone: fmResult.phone, source: 'findymail' });
        // Also add any additional phones
        if (fmResult.phones) {
          for (const p of fmResult.phones) {
            if (p.phone !== fmResult.phone) {
              allPhones.push({ phone: p.phone, type: p.type, label: p.label, source: 'findymail' });
            }
          }
        }

        trackCostFireAndForget({
          provider: 'findymail',
          endpoint: 'search/phone',
          entityType: 'contact',
          success: true,
          metadata: { found: true, phoneCount: allPhones.length },
        });
      }
    } catch (err) {
      console.warn(`[PhoneEnrich] Findymail phone failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Stage 3: Hunter phone by name (if still no phone and we have name + domain)
  if (allPhones.length === 0 && contact.firstName && contact.lastName && contact.domain) {
    try {
      const hunterResult = await findPhoneByName(contact.firstName, contact.lastName, contact.domain);
      if (hunterResult.found && hunterResult.phone) {
        allPhones.push({ phone: hunterResult.phone, source: 'hunter' });
      }
    } catch (err) {
      console.warn(`[PhoneEnrich] Hunter phone failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const result: PhoneEnrichmentResult = {
    found: allPhones.length > 0,
    phone: allPhones[0]?.phone ?? null,
    phones: allPhones,
    source: allPhones[0]?.source as PhoneEnrichmentResult['source'] ?? null,
  };

  // Cache result
  if (cacheKey) {
    const ttl = result.found ? CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SECONDS;
    await cacheSet(cacheKey, result, ttl);
  }

  console.log(`[PhoneEnrich] Result: found=${result.found}, source=${result.source}, phones=${allPhones.length}`);
  return result;
}
