export interface BuildingClassInput {
  qualityGrade: string | null;
  conditionGrade: string | null;
  yearBuilt: number | null;
  totalValue: number | null;
  buildingSqft: number | null;
}

export interface BuildingClassResult {
  buildingClass: string;
  rationale: string;
}

const QUALITY_SCORES: Record<string, number> = {
  'EXCELLENT': 5,
  'VERY GOOD': 4.5,
  'GOOD': 4,
  'ABOVE AVERAGE': 3.5,
  'AVERAGE': 3,
  'BELOW AVERAGE': 2.5,
  'FAIR': 2,
  'POOR': 1,
  'VERY POOR': 0.5,
};

const CONDITION_SCORES: Record<string, number> = {
  'EXCELLENT': 5,
  'VERY GOOD': 4.5,
  'GOOD': 4,
  'ABOVE AVERAGE': 3.5,
  'AVERAGE': 3,
  'BELOW AVERAGE': 2.5,
  'FAIR': 2,
  'POOR': 1,
  'VERY POOR': 0.5,
  'UNSOUND': 0,
};

function normalizeGrade(grade: string | null): string | null {
  if (!grade) return null;
  return grade.toUpperCase().trim();
}

function getQualityScore(grade: string | null): number | null {
  const normalized = normalizeGrade(grade);
  if (!normalized) return null;
  return QUALITY_SCORES[normalized] ?? null;
}

function getConditionScore(grade: string | null): number | null {
  const normalized = normalizeGrade(grade);
  if (!normalized) return null;
  return CONDITION_SCORES[normalized] ?? null;
}

function getAgeScore(yearBuilt: number | null): number {
  if (!yearBuilt || yearBuilt <= 0) return 2.5;
  
  const currentYear = new Date().getFullYear();
  const age = currentYear - yearBuilt;
  
  if (age <= 5) return 5;
  if (age <= 10) return 4.5;
  if (age <= 15) return 4;
  if (age <= 25) return 3.5;
  if (age <= 35) return 3;
  if (age <= 50) return 2.5;
  if (age <= 75) return 2;
  return 1.5;
}

function getValuePerSqftScore(totalValue: number | null, buildingSqft: number | null): number {
  if (!totalValue || !buildingSqft || buildingSqft <= 0) return 2.5;
  
  const valuePerSqft = totalValue / buildingSqft;
  
  if (valuePerSqft >= 400) return 5;
  if (valuePerSqft >= 300) return 4.5;
  if (valuePerSqft >= 200) return 4;
  if (valuePerSqft >= 150) return 3.5;
  if (valuePerSqft >= 100) return 3;
  if (valuePerSqft >= 75) return 2.5;
  if (valuePerSqft >= 50) return 2;
  return 1.5;
}

export function calculateBuildingClass(input: BuildingClassInput): BuildingClassResult {
  const qualityScore = getQualityScore(input.qualityGrade);
  const conditionScore = getConditionScore(input.conditionGrade);
  const ageScore = getAgeScore(input.yearBuilt);
  const valueScore = getValuePerSqftScore(input.totalValue, input.buildingSqft);
  
  const scores: number[] = [];
  const factors: string[] = [];
  
  if (qualityScore !== null) {
    scores.push(qualityScore * 0.35);
    factors.push(`Quality: ${input.qualityGrade}`);
  }
  if (conditionScore !== null) {
    scores.push(conditionScore * 0.30);
    factors.push(`Condition: ${input.conditionGrade}`);
  }
  
  scores.push(ageScore * 0.20);
  if (input.yearBuilt) {
    factors.push(`Age: ${new Date().getFullYear() - input.yearBuilt} years`);
  }
  
  scores.push(valueScore * 0.15);
  if (input.totalValue && input.buildingSqft) {
    factors.push(`Value: $${Math.round(input.totalValue / input.buildingSqft)}/sqft`);
  }
  
  const totalWeight = (qualityScore !== null ? 0.35 : 0) + 
                       (conditionScore !== null ? 0.30 : 0) + 
                       0.20 + 0.15;
  
  const weightedScore = scores.reduce((a, b) => a + b, 0) / totalWeight;
  
  let buildingClass: string;
  if (weightedScore >= 4.5) {
    buildingClass = 'A+';
  } else if (weightedScore >= 4.0) {
    buildingClass = 'A';
  } else if (weightedScore >= 3.0) {
    buildingClass = 'B';
  } else if (weightedScore >= 2.0) {
    buildingClass = 'C';
  } else {
    buildingClass = 'D';
  }
  
  const rationale = factors.length > 0 
    ? `Score: ${weightedScore.toFixed(2)} - ${factors.join(', ')}`
    : `Score: ${weightedScore.toFixed(2)} - Based on age and value metrics`;
  
  return { buildingClass, rationale };
}

export function extractPrimaryHvacTypes(buildings: any[]): { acType: string | null; heatingType: string | null } {
  if (!buildings || !Array.isArray(buildings) || buildings.length === 0) {
    return { acType: null, heatingType: null };
  }
  
  const acCounts = new Map<string, number>();
  const heatingCounts = new Map<string, number>();
  
  for (const building of buildings) {
    const acType = building.acType || building.AC_TYPE;
    const heatingType = building.heatingType || building.HEATING_TYPE;
    
    if (acType && typeof acType === 'string') {
      const normalized = acType.trim().toUpperCase();
      if (normalized && normalized !== 'NONE' && normalized !== 'N/A') {
        acCounts.set(normalized, (acCounts.get(normalized) || 0) + 1);
      }
    }
    
    if (heatingType && typeof heatingType === 'string') {
      const normalized = heatingType.trim().toUpperCase();
      if (normalized && normalized !== 'NONE' && normalized !== 'N/A') {
        heatingCounts.set(normalized, (heatingCounts.get(normalized) || 0) + 1);
      }
    }
  }
  
  let primaryAc: string | null = null;
  let maxAcCount = 0;
  for (const [type, count] of acCounts) {
    if (count > maxAcCount) {
      maxAcCount = count;
      primaryAc = type;
    }
  }
  
  let primaryHeating: string | null = null;
  let maxHeatingCount = 0;
  for (const [type, count] of heatingCounts) {
    if (count > maxHeatingCount) {
      maxHeatingCount = count;
      primaryHeating = type;
    }
  }
  
  return { acType: primaryAc, heatingType: primaryHeating };
}

export function extractPrimaryQualityGrade(buildings: any[]): { qualityGrade: string | null; conditionGrade: string | null } {
  if (!buildings || !Array.isArray(buildings) || buildings.length === 0) {
    return { qualityGrade: null, conditionGrade: null };
  }
  
  const qualityCounts = new Map<string, number>();
  const conditionCounts = new Map<string, number>();
  
  for (const building of buildings) {
    const quality = building.qualityGrade || building.QUALITY_GRADE;
    const condition = building.conditionGrade || building.CONDITION_GRADE;
    
    if (quality && typeof quality === 'string') {
      const normalized = quality.trim().toUpperCase();
      if (normalized) {
        qualityCounts.set(normalized, (qualityCounts.get(normalized) || 0) + 1);
      }
    }
    
    if (condition && typeof condition === 'string') {
      const normalized = condition.trim().toUpperCase();
      if (normalized) {
        conditionCounts.set(normalized, (conditionCounts.get(normalized) || 0) + 1);
      }
    }
  }
  
  let primaryQuality: string | null = null;
  let maxQualityCount = 0;
  for (const [grade, count] of qualityCounts) {
    if (count > maxQualityCount) {
      maxQualityCount = count;
      primaryQuality = grade;
    }
  }
  
  let primaryCondition: string | null = null;
  let maxConditionCount = 0;
  for (const [grade, count] of conditionCounts) {
    if (count > maxConditionCount) {
      maxConditionCount = count;
      primaryCondition = grade;
    }
  }
  
  return { qualityGrade: primaryQuality, conditionGrade: primaryCondition };
}
