import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

export function formatPhoneNumber(phone: string | null | undefined, extension?: string | null, defaultCountry: CountryCode = 'US'): string {
  if (!phone) return '';
  
  try {
    const { number: cleanedNumber, ext: extractedExt } = extractExtension(phone.trim());
    const ext = extension || extractedExt;
    
    let formatted = cleanedNumber;
    
    if (isValidPhoneNumber(cleanedNumber, defaultCountry)) {
      const parsed = parsePhoneNumber(cleanedNumber, defaultCountry);
      const country = parsed.country || defaultCountry;
      const national = parsed.formatNational();
      const countryCallingCode = parsed.countryCallingCode;
      formatted = `+${countryCallingCode} ${national}`;
    } else {
      try {
        const parsed = parsePhoneNumber(cleanedNumber);
        if (parsed) {
          const national = parsed.formatNational();
          const countryCallingCode = parsed.countryCallingCode;
          formatted = `+${countryCallingCode} ${national}`;
        }
      } catch {
        formatted = cleanedNumber;
      }
    }
    
    if (ext) {
      formatted += ` ext. ${ext}`;
    }
    
    return formatted;
  } catch {
    return phone.trim();
  }
}

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

export function normalizePhoneNumber(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): string | null {
  if (!phone) return null;
  
  try {
    const { number: cleanedNumber } = extractExtension(phone.trim());
    
    if (isValidPhoneNumber(cleanedNumber, defaultCountry)) {
      const parsed = parsePhoneNumber(cleanedNumber, defaultCountry);
      return parsed.format('E.164');
    }
    
    const parsed = parsePhoneNumber(cleanedNumber);
    if (parsed) {
      return parsed.format('E.164');
    }
    
    return cleanedNumber;
  } catch {
    return phone.trim();
  }
}

export function normalizePhoneWithExtension(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): { normalized: string | null; extension: string | null } {
  if (!phone) return { normalized: null, extension: null };
  
  const { number: cleanedNumber, ext } = extractExtension(phone.trim());
  const normalized = normalizePhoneNumber(cleanedNumber, defaultCountry);
  
  return {
    normalized,
    extension: ext || null,
  };
}

function extractExtension(phone: string): { number: string; ext: string | null } {
  const extPatterns = [
    /[,;]\s*(\d{1,8})\s*$/,
    /\s+(?:ext\.?|x|extension)\s*[:#]?\s*(\d{1,8})\s*$/i,
    /\s*#\s*(\d{1,8})\s*$/,
  ];
  
  for (const pattern of extPatterns) {
    const match = phone.match(pattern);
    if (match) {
      return {
        number: phone.substring(0, match.index!).trim(),
        ext: match[1],
      };
    }
  }
  
  return { number: phone, ext: null };
}

export function isValidPhone(phone: string | null | undefined, defaultCountry: CountryCode = 'US'): boolean {
  if (!phone) return false;
  
  try {
    const { number: cleanedNumber } = extractExtension(phone.trim());
    
    if (isValidPhoneNumber(cleanedNumber, defaultCountry)) {
      return true;
    }
    
    const parsed = parsePhoneNumber(cleanedNumber);
    return parsed?.isValid() ?? false;
  } catch {
    return false;
  }
}
