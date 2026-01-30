/**
 * Phone number formatting utility using libphonenumber-js
 */

import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

/**
 * Format a phone number to national format (e.g., (214) 555-1234)
 * Falls back to original if parsing fails
 */
export function formatPhoneNumber(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): string {
  if (!phone) return '';
  
  try {
    // Clean the phone number
    const cleaned = phone.trim();
    
    // Try to parse and format
    if (isValidPhoneNumber(cleaned, defaultCountry)) {
      const parsed = parsePhoneNumber(cleaned, defaultCountry);
      return parsed.formatNational();
    }
    
    // If not valid in default country, try parsing as international
    const parsed = parsePhoneNumber(cleaned);
    if (parsed) {
      return parsed.formatNational();
    }
    
    return cleaned;
  } catch {
    // Return original if parsing fails
    return phone.trim();
  }
}

/**
 * Format a phone number to international format (e.g., +1 214 555 1234)
 */
export function formatPhoneInternational(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): string {
  if (!phone) return '';
  
  try {
    const cleaned = phone.trim();
    
    if (isValidPhoneNumber(cleaned, defaultCountry)) {
      const parsed = parsePhoneNumber(cleaned, defaultCountry);
      return parsed.formatInternational();
    }
    
    const parsed = parsePhoneNumber(cleaned);
    if (parsed) {
      return parsed.formatInternational();
    }
    
    return cleaned;
  } catch {
    return phone.trim();
  }
}

/**
 * Normalize a phone number to E.164 format for storage (e.g., +12145551234)
 */
export function normalizePhoneNumber(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): string | null {
  if (!phone) return null;
  
  try {
    const cleaned = phone.trim();
    
    if (isValidPhoneNumber(cleaned, defaultCountry)) {
      const parsed = parsePhoneNumber(cleaned, defaultCountry);
      return parsed.format('E.164');
    }
    
    const parsed = parsePhoneNumber(cleaned);
    if (parsed) {
      return parsed.format('E.164');
    }
    
    return cleaned;
  } catch {
    return phone.trim();
  }
}

/**
 * Check if a phone number is valid
 */
export function isValidPhone(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): boolean {
  if (!phone) return false;
  
  try {
    const cleaned = phone.trim();
    
    if (isValidPhoneNumber(cleaned, defaultCountry)) {
      return true;
    }
    
    // Try parsing as international
    const parsed = parsePhoneNumber(cleaned);
    return parsed?.isValid() ?? false;
  } catch {
    return false;
  }
}
