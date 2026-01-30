const UPPERCASE_PRESERVATIONS = new Set([
  'LLC', 'LP', 'LLP', 'INC', 'CORP', 'CO', 'LTD', 'USA', 'US', 'TX', 'OK', 'LA', 'AR', 'NM',
  'NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'PO', 'APT', 'STE', 'BLDG', 'FL', 'RM', 'UNIT',
]);

const STREET_SUFFIXES: Record<string, string> = {
  'ST': 'St', 'STREET': 'St', 'AVE': 'Ave', 'AVENUE': 'Ave',
  'BLVD': 'Blvd', 'BOULEVARD': 'Blvd', 'DR': 'Dr', 'DRIVE': 'Dr',
  'RD': 'Rd', 'ROAD': 'Rd', 'LN': 'Ln', 'LANE': 'Ln',
  'CT': 'Ct', 'COURT': 'Ct', 'CIR': 'Cir', 'CIRCLE': 'Cir',
  'WAY': 'Way', 'PL': 'Pl', 'PLACE': 'Pl', 'TRL': 'Trl', 'TRAIL': 'Trl',
  'PKWY': 'Pkwy', 'PARKWAY': 'Pkwy', 'HWY': 'Hwy', 'HIGHWAY': 'Hwy',
  'FWY': 'Fwy', 'FREEWAY': 'Fwy', 'EXPY': 'Expy', 'EXPRESSWAY': 'Expy',
  'SQ': 'Sq', 'SQUARE': 'Sq', 'LOOP': 'Loop', 'PATH': 'Path',
  'PASS': 'Pass', 'PIKE': 'Pike', 'PLZ': 'Plz', 'PLAZA': 'Plz',
  'TER': 'Ter', 'TERRACE': 'Ter', 'ALY': 'Aly', 'ALLEY': 'Aly',
  'XING': 'Xing', 'CROSSING': 'Xing', 'CRST': 'Crst', 'CREST': 'Crst',
  'CV': 'Cv', 'COVE': 'Cv', 'VW': 'Vw', 'VIEW': 'Vw',
  'PT': 'Pt', 'POINT': 'Pt', 'RUN': 'Run', 'ROW': 'Row',
};

const DIRECTIONALS: Record<string, string> = {
  'N': 'N', 'NORTH': 'N',
  'S': 'S', 'SOUTH': 'S',
  'E': 'E', 'EAST': 'E',
  'W': 'W', 'WEST': 'W',
  'NE': 'NE', 'NORTHEAST': 'NE',
  'NW': 'NW', 'NORTHWEST': 'NW',
  'SE': 'SE', 'SOUTHEAST': 'SE',
  'SW': 'SW', 'SOUTHWEST': 'SW',
};

export function toTitleCase(word: string): string {
  if (!word) return word;
  if (word.length === 1) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return '';
  
  const words = address.trim().split(/\s+/);
  const result: string[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const upper = word.toUpperCase();
    
    if (/^\d+$/.test(word)) {
      result.push(word);
    } else if (DIRECTIONALS[upper]) {
      result.push(DIRECTIONALS[upper]);
    } else if (STREET_SUFFIXES[upper]) {
      result.push(STREET_SUFFIXES[upper]);
    } else if (UPPERCASE_PRESERVATIONS.has(upper)) {
      result.push(upper);
    } else if (upper === '#') {
      result.push('#');
    } else if (/^#\d+/.test(upper)) {
      result.push(word);
    } else {
      result.push(toTitleCase(word));
    }
  }
  
  return result.join(' ');
}

export function normalizeOwnerName(name: string | null | undefined): string {
  if (!name) return '';
  
  const words = name.trim().split(/\s+/);
  const result: string[] = [];
  
  for (const word of words) {
    const upper = word.toUpperCase();
    
    if (UPPERCASE_PRESERVATIONS.has(upper)) {
      result.push(upper);
    } else if (upper === '&' || upper === 'AND') {
      result.push('&');
    } else if (upper === 'THE') {
      result.push('the');
    } else if (upper === 'OF') {
      result.push('of');
    } else if (/^[A-Z]{2,}$/.test(upper) && upper.length <= 3) {
      result.push(upper);
    } else {
      result.push(toTitleCase(word));
    }
  }
  
  return result.join(' ');
}

export function normalizeCommonName(name: string | null | undefined): string {
  if (!name) return '';
  return normalizeOwnerName(name);
}

export function normalizeCity(city: string | null | undefined): string {
  if (!city) return '';
  return city.split(/\s+/).map(toTitleCase).join(' ');
}

export function normalizeCounty(county: string | null | undefined): string {
  if (!county) return '';
  return county.split(/\s+/).map(toTitleCase).join(' ');
}

export function normalizeAllFields(data: {
  address?: string | null;
  owner?: string | null;
  owner2?: string | null;
  city?: string | null;
  county?: string | null;
  commonName?: string | null;
}): {
  address: string;
  owner: string;
  owner2: string;
  city: string;
  county: string;
  commonName: string;
} {
  return {
    address: normalizeAddress(data.address),
    owner: normalizeOwnerName(data.owner),
    owner2: normalizeOwnerName(data.owner2),
    city: normalizeCity(data.city),
    county: normalizeCounty(data.county),
    commonName: normalizeCommonName(data.commonName),
  };
}
