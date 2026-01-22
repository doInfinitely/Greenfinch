import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { fetchParcelsFromZipCode, countParcelsInZipCode, aggregateParcelsToProperties } from '@/lib/ingestion';
import { classifyPropertyType, type ClassificationResult, type PropertyClassification } from '@/lib/zoning-classification';
import { enrichWithMapboxPOI, type MapboxPOIResult } from '@/lib/mapbox-poi';

export async function GET(request: Request) {
  try {
    await requireAdminAccess();
    
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const skipPoi = url.searchParams.get('skipPoi') === 'true';
    const zipCode = url.searchParams.get('zip') || '75225';
    
    console.log(`[Test Zoning Classification] Fetching parcels from ZIP ${zipCode}...`);
    
    const totalCount = await countParcelsInZipCode(zipCode);
    console.log(`[Test Zoning Classification] Total parcels in ZIP ${zipCode}: ${totalCount}`);
    
    const parcels = await fetchParcelsFromZipCode(zipCode, limit * 3, 0);
    console.log(`[Test Zoning Classification] Fetched ${parcels.length} parcels`);
    
    const propertyMap = aggregateParcelsToProperties(parcels);
    console.log(`[Test Zoning Classification] Aggregated into ${propertyMap.size} properties`);
    
    const properties = Array.from(propertyMap.values()).slice(0, limit);
    console.log(`[Test Zoning Classification] Testing on ${properties.length} properties`);
    
    interface TestResult {
      address: string;
      city: string;
      lat: number;
      lon: number;
      usedesc: string[];
      zoningDescription: string[];
      classificationResult: ClassificationResult;
      mapboxPOI: MapboxPOIResult | null;
      finalCategory: string;
      finalSubcategory: string;
      operationalStatus: string;
    }
    
    const results: TestResult[] = [];
    let commercialCount = 0;
    let poiMatchCount = 0;
    const categoryDistribution: Record<string, number> = {};
    const operationalStatusDistribution: Record<string, number> = {};
    
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      
      const usedescStr = property.usedesc.join(' ');
      const zoningDescStr = property.zoningDescription.join(' ');
      
      const classificationResult = classifyPropertyType(usedescStr, zoningDescStr);
      const isCommercialOrMultifamily = classificationResult.classification === 'commercial' || classificationResult.classification === 'multifamily';
      
      if (isCommercialOrMultifamily) {
        commercialCount++;
      }
      
      let poiResult: MapboxPOIResult | null = null;
      let finalCategory = 'Unknown';
      let finalSubcategory = 'Unknown';
      let operationalStatus = 'unknown';
      
      if (isCommercialOrMultifamily && !skipPoi && property.lat && property.lon) {
        console.log(`[Test Zoning Classification] Enriching ${i + 1}/${properties.length}: ${property.address}`);
        poiResult = await enrichWithMapboxPOI(property.lat, property.lon);
        
        if (poiResult.category !== 'Unknown') {
          poiMatchCount++;
          finalCategory = poiResult.category;
          finalSubcategory = poiResult.subcategory;
        } else {
          finalCategory = mapClassificationToCategory(classificationResult.classification);
          finalSubcategory = 'Other';
        }
        operationalStatus = poiResult.operationalStatus;
      } else if (isCommercialOrMultifamily) {
        finalCategory = mapClassificationToCategory(classificationResult.classification);
        finalSubcategory = 'Other';
      }
      
      categoryDistribution[finalCategory] = (categoryDistribution[finalCategory] || 0) + 1;
      operationalStatusDistribution[operationalStatus] = (operationalStatusDistribution[operationalStatus] || 0) + 1;
      
      results.push({
        address: property.address,
        city: property.city,
        lat: property.lat,
        lon: property.lon,
        usedesc: property.usedesc,
        zoningDescription: property.zoningDescription,
        classificationResult,
        mapboxPOI: poiResult,
        finalCategory,
        finalSubcategory,
        operationalStatus,
      });
    }
    
    const summary = {
      zipCode,
      totalParcelsInZip: totalCount,
      propertiesTested: properties.length,
      commercialMultifamilyCount: commercialCount,
      commercialMultifamilyPercentage: properties.length > 0 
        ? `${((commercialCount / properties.length) * 100).toFixed(1)}%` 
        : '0.0%',
      poiMatchCount,
      poiMatchPercentage: commercialCount > 0 
        ? `${((poiMatchCount / commercialCount) * 100).toFixed(1)}%` 
        : 'N/A',
      categoryDistribution: Object.entries(categoryDistribution)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({
          category,
          count,
          percentage: properties.length > 0 
            ? `${((count / properties.length) * 100).toFixed(1)}%` 
            : '0.0%',
        })),
      operationalStatusDistribution: Object.entries(operationalStatusDistribution)
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({
          status,
          count,
          percentage: properties.length > 0 
            ? `${((count / properties.length) * 100).toFixed(1)}%` 
            : '0.0%',
        })),
    };
    
    return NextResponse.json({
      summary,
      results,
    });
    
  } catch (error) {
    console.error('[Test Zoning Classification] Error:', error);
    return NextResponse.json(
      { error: 'Failed to test classification', details: String(error) },
      { status: 500 }
    );
  }
}

function mapClassificationToCategory(classification: PropertyClassification): string {
  switch (classification) {
    case 'commercial':
      return 'Retail';
    case 'multifamily':
      return 'Multifamily';
    case 'single_family':
      return 'Single Family';
    case 'public':
      return 'Public/Institutional';
    default:
      return 'Unknown';
  }
}
