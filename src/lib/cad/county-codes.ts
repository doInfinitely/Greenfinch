import type { CountyCode } from './types';

// Maps county-specific SPTD codes to standardized PTAD codes
// DCAD uses legacy codes (B11, F10, F20), while TAD/CCAD/DENT may use PTAD directly

interface CodeMapping {
  sptdCode: string;
  ptadCode: string;
  include: boolean;
}

const DCAD_CODE_MAP: CodeMapping[] = [
  { sptdCode: 'B11', ptadCode: 'B', include: true },   // Apartments
  { sptdCode: 'B12', ptadCode: 'B', include: false },  // Duplexes
  { sptdCode: 'F10', ptadCode: 'F1', include: true },  // Commercial
  { sptdCode: 'F20', ptadCode: 'F2', include: true },  // Industrial
  { sptdCode: 'A11', ptadCode: 'A', include: false },
  { sptdCode: 'A12', ptadCode: 'A', include: false },
  { sptdCode: 'A13', ptadCode: 'A', include: false },
  { sptdCode: 'A20', ptadCode: 'A', include: false },
  { sptdCode: 'C11', ptadCode: 'C1', include: false },
  { sptdCode: 'C12', ptadCode: 'C1', include: false },
  { sptdCode: 'C13', ptadCode: 'C1', include: false },
  { sptdCode: 'C14', ptadCode: 'C1', include: false },
  { sptdCode: 'D10', ptadCode: 'D1', include: false },
  { sptdCode: 'D20', ptadCode: 'D2', include: false },
  { sptdCode: 'L10', ptadCode: 'L1', include: false },
  { sptdCode: 'L20', ptadCode: 'L2', include: false },
];

// HCAD uses PTAD codes directly (property_use_cd field)
const HCAD_CODE_MAP: CodeMapping[] = [
  { sptdCode: 'F1', ptadCode: 'F1', include: true },   // Commercial
  { sptdCode: 'F2', ptadCode: 'F2', include: true },   // Industrial
  { sptdCode: 'B1', ptadCode: 'B', include: true },    // Multi-family
  { sptdCode: 'B4', ptadCode: 'B', include: true },    // Four+ family
  { sptdCode: 'A1', ptadCode: 'A', include: false },   // Single-family
  { sptdCode: 'A2', ptadCode: 'A', include: false },   // Mobile homes
  { sptdCode: 'A3', ptadCode: 'A', include: false },   // Aux buildings
  { sptdCode: 'A4', ptadCode: 'A', include: false },   // Half duplex
  { sptdCode: 'B2', ptadCode: 'B', include: false },   // Two-family
  { sptdCode: 'B3', ptadCode: 'B', include: false },   // Three-family
  { sptdCode: 'C1', ptadCode: 'C1', include: false },  // Vacant lots (city)
  { sptdCode: 'C2', ptadCode: 'C2', include: false },  // Vacant commercial
  { sptdCode: 'C3', ptadCode: 'C3', include: false },  // Vacant lots (rural)
  { sptdCode: 'D1', ptadCode: 'D1', include: false },
  { sptdCode: 'D2', ptadCode: 'D2', include: false },
  { sptdCode: 'E1', ptadCode: 'E1', include: false },  // Farm & ranch
  { sptdCode: 'L1', ptadCode: 'L1', include: false },
  { sptdCode: 'L2', ptadCode: 'L2', include: false },
  { sptdCode: 'X1', ptadCode: 'X', include: false },   // Exempt
];

// TAD, CCAD, DENT, CHAM use standard PTAD codes
const PTAD_CODE_MAP: CodeMapping[] = [
  { sptdCode: 'B', ptadCode: 'B', include: true },
  { sptdCode: 'B1', ptadCode: 'B', include: true },   // Some counties use B1
  { sptdCode: 'F1', ptadCode: 'F1', include: true },
  { sptdCode: 'F2', ptadCode: 'F2', include: true },
  { sptdCode: 'A', ptadCode: 'A', include: false },
  { sptdCode: 'A1', ptadCode: 'A', include: false },
  { sptdCode: 'C1', ptadCode: 'C1', include: false },
  { sptdCode: 'D1', ptadCode: 'D1', include: false },
  { sptdCode: 'D2', ptadCode: 'D2', include: false },
  { sptdCode: 'L1', ptadCode: 'L1', include: false },
  { sptdCode: 'L2', ptadCode: 'L2', include: false },
];

const CODE_MAPS: Record<CountyCode, CodeMapping[]> = {
  DCAD: DCAD_CODE_MAP,
  TAD: PTAD_CODE_MAP,
  CCAD: PTAD_CODE_MAP,
  DENT: PTAD_CODE_MAP,
  HCAD: HCAD_CODE_MAP,
  CHAM: PTAD_CODE_MAP,
};

// Included PTAD codes for property filtering
export const INCLUDED_PTAD_CODES = ['B', 'F1', 'F2'];

export function toPtadCode(countyCode: CountyCode, nativeCode: string | null): string | null {
  if (!nativeCode) return null;
  const trimmed = nativeCode.trim();
  const map = CODE_MAPS[countyCode];
  const found = map.find(m => m.sptdCode === trimmed);
  if (found) return found.ptadCode;
  // If not in the county-specific map, check if it's already a PTAD code
  if (INCLUDED_PTAD_CODES.includes(trimmed)) return trimmed;
  return null;
}

export function isIncludedProperty(countyCode: CountyCode, nativeCode: string | null): boolean {
  if (!nativeCode) return false;
  const trimmed = nativeCode.trim();
  const map = CODE_MAPS[countyCode];
  const found = map.find(m => m.sptdCode === trimmed);
  if (found) return found.include;
  // Fall back: check if the PTAD equivalent is included
  return INCLUDED_PTAD_CODES.includes(trimmed);
}

export function getCountyName(countyCode: CountyCode): string {
  const names: Record<CountyCode, string> = {
    DCAD: 'DALLAS',
    TAD: 'TARRANT',
    CCAD: 'COLLIN',
    DENT: 'DENTON',
    HCAD: 'HARRIS',
    CHAM: 'CHAMBERS',
  };
  return names[countyCode];
}
