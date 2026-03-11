import { sql, inArray, and, gte, lte, type SQL } from 'drizzle-orm';
import { properties } from '@/lib/schema';
import type { TerritoryDefinition, TerritoryDefinitionZipCodes, TerritoryDefinitionCounties, TerritoryDefinitionPolygon } from '@/lib/schema';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';
import bbox from '@turf/bbox';

/**
 * Build SQL conditions to filter properties by territory definition.
 * For zip_codes and counties, returns SQL conditions directly.
 * For polygon, returns a bounding-box pre-filter (results need post-filtering with filterByPolygon).
 */
export function buildTerritoryConditions(definition: TerritoryDefinition, type: string): SQL[] {
  const conditions: SQL[] = [];

  if (type === 'zip_codes') {
    const def = definition as TerritoryDefinitionZipCodes;
    if (def.zipCodes && def.zipCodes.length > 0) {
      conditions.push(
        sql`LEFT(${properties.zip}, 5) IN (${sql.join(def.zipCodes.map(z => sql`${z}`), sql`, `)})`
      );
    }
  } else if (type === 'counties') {
    const def = definition as TerritoryDefinitionCounties;
    if (def.counties && def.counties.length > 0) {
      conditions.push(inArray(properties.county, def.counties));
    }
  } else if (type === 'polygon') {
    const def = definition as TerritoryDefinitionPolygon;
    if (def.geometry) {
      // Bounding-box pre-filter for performance
      const [minLng, minLat, maxLng, maxLat] = bbox(polygon(def.geometry.coordinates));
      conditions.push(
        gte(properties.lat, minLat),
        lte(properties.lat, maxLat),
        gte(properties.lon, minLng),
        lte(properties.lon, maxLng)
      );
    }
  }

  return conditions;
}

/**
 * Post-query filter for polygon territories.
 * Takes results with lat/lon and filters to only those within the polygon.
 */
export function filterByPolygon<T extends { lat: number | null; lon: number | null }>(
  items: T[],
  definition: TerritoryDefinitionPolygon
): T[] {
  if (!definition.geometry) return items;
  const poly = polygon(definition.geometry.coordinates);
  return items.filter(item => {
    if (item.lat == null || item.lon == null) return false;
    return booleanPointInPolygon(point([item.lon, item.lat]), poly);
  });
}

/**
 * Check if a territory type requires post-query polygon filtering.
 */
export function needsPolygonFilter(type: string): boolean {
  return type === 'polygon';
}
