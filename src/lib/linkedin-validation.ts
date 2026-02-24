import { getNameVariants } from './nicknames';

export interface LinkedInValidationResult {
  valid: boolean;
  reason: 'match' | 'hashed_id' | 'no_slug' | 'missing_data' | 'neither_name' | 'first_name_missing' | 'last_name_missing';
  slug: string | null;
}

/**
 * Validates that a LinkedIn profile URL slug plausibly belongs to the given person.
 *
 * Rules:
 * - Hashed PDL IDs (starting with ACw) are skipped — cannot name-validate them.
 * - At least one slug token must match the first name (or a known nickname variant).
 * - At least one slug token must match the last name.
 * - Minimum token length of 3 chars to avoid false positives on short tokens.
 * - Spelling variants (erik ≠ eric) are intentionally NOT accepted — only true
 *   nickname/diminutive relationships from the Carlton Northern dataset.
 */
export function validateLinkedInSlug(
  url: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): LinkedInValidationResult {
  if (!url || !firstName) {
    return { valid: false, reason: 'missing_data', slug: null };
  }

  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) {
    return { valid: false, reason: 'no_slug', slug: null };
  }

  const rawSlug = decodeURIComponent(match[1]);

  if (/^ACw/i.test(rawSlug)) {
    return { valid: true, reason: 'hashed_id', slug: rawSlug };
  }

  const slug = rawSlug
    .replace(/-[0-9a-f]{6,}$/i, '')
    .toLowerCase();

  const tokens = slug.split('-').filter(t => t.length >= 3);

  const fn = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const ln = lastName ? lastName.toLowerCase().replace(/[^a-z]/g, '') : null;

  const firstNameVariants = fn.length >= 3 ? getNameVariants(fn) : [fn];

  const firstMatch = fn.length >= 3 && tokens.some(token =>
    firstNameVariants.some(variant => variant.length >= 3 && (token.includes(variant) || variant.includes(token)))
  );

  const lastMatch = !ln || ln.length < 3 || tokens.some(token =>
    token.includes(ln) || ln.includes(token)
  );

  if (!firstMatch && !lastMatch) return { valid: false, reason: 'neither_name', slug: rawSlug };
  if (!firstMatch) return { valid: false, reason: 'first_name_missing', slug: rawSlug };
  if (!lastMatch) return { valid: false, reason: 'last_name_missing', slug: rawSlug };

  return { valid: true, reason: 'match', slug: rawSlug };
}
