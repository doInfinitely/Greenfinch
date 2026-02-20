import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ingestionSettings } from '@/lib/schema';
import { requireAdminAccess, getSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';

const DEFAULT_SETTINGS = {
  zip_codes: ['75225'],
  default_limit: 500,
  all_zips: false,
  filters: {
    lotSqftMin: null as number | null,
    lotSqftMax: null as number | null,
    buildingSqftMin: null as number | null,
    buildingSqftMax: null as number | null,
    buildingClassCodes: [] as string[],
    conditionGrades: [] as string[],
  },
};

export async function GET() {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const settings = await db.select().from(ingestionSettings);
    
    const settingsMap: Record<string, unknown> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    const storedFilters = settingsMap.ingestion_filters as typeof DEFAULT_SETTINGS.filters | undefined;
    
    return NextResponse.json({
      zipCodes: (settingsMap.zip_codes as string[]) || DEFAULT_SETTINGS.zip_codes,
      defaultLimit: (settingsMap.default_limit as number) || DEFAULT_SETTINGS.default_limit,
      allZips: settingsMap.all_zips === true ? true : DEFAULT_SETTINGS.all_zips,
      filters: storedFilters || DEFAULT_SETTINGS.filters,
    });
  } catch (error) {
    console.error('[IngestionSettings] Error fetching settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { zipCodes, defaultLimit, allZips, filters } = body;

    const session = await getSession();
    const userId = session?.user?.id || null;

    if (allZips !== undefined) {
      const allZipsValue = allZips === true;
      const existingSetting = await db.select().from(ingestionSettings).where(eq(ingestionSettings.key, 'all_zips'));
      
      if (existingSetting.length > 0) {
        await db.update(ingestionSettings)
          .set({ 
            value: allZipsValue, 
            updatedAt: new Date(),
            updatedByUserId: userId 
          })
          .where(eq(ingestionSettings.key, 'all_zips'));
      } else {
        await db.insert(ingestionSettings).values({
          key: 'all_zips',
          value: allZipsValue,
          description: 'Whether to ingest all ZIP codes instead of specific ones',
          updatedByUserId: userId,
        });
      }
    }

    if (zipCodes !== undefined) {
      if (!Array.isArray(zipCodes)) {
        return NextResponse.json({ error: 'zipCodes must be an array' }, { status: 400 });
      }
      
      const validZips = zipCodes.filter(z => typeof z === 'string' && /^\d{5}$/.test(z));
      if (allZips !== true && validZips.length === 0) {
        return NextResponse.json({ error: 'At least one valid 5-digit ZIP code is required' }, { status: 400 });
      }

      const existingZipSetting = await db.select().from(ingestionSettings).where(eq(ingestionSettings.key, 'zip_codes'));
      
      if (existingZipSetting.length > 0) {
        await db.update(ingestionSettings)
          .set({ 
            value: validZips, 
            updatedAt: new Date(),
            updatedByUserId: userId 
          })
          .where(eq(ingestionSettings.key, 'zip_codes'));
      } else {
        await db.insert(ingestionSettings).values({
          key: 'zip_codes',
          value: validZips,
          description: 'ZIP codes to include in ingestion',
          updatedByUserId: userId,
        });
      }
    }

    if (defaultLimit !== undefined) {
      const limit = parseInt(defaultLimit);
      if (isNaN(limit) || limit < 1 || limit > 100000) {
        return NextResponse.json({ error: 'defaultLimit must be between 1 and 100000' }, { status: 400 });
      }

      const existingLimitSetting = await db.select().from(ingestionSettings).where(eq(ingestionSettings.key, 'default_limit'));
      
      if (existingLimitSetting.length > 0) {
        await db.update(ingestionSettings)
          .set({ 
            value: limit, 
            updatedAt: new Date(),
            updatedByUserId: userId 
          })
          .where(eq(ingestionSettings.key, 'default_limit'));
      } else {
        await db.insert(ingestionSettings).values({
          key: 'default_limit',
          value: limit,
          description: 'Default row limit for ingestion',
          updatedByUserId: userId,
        });
      }
    }

    if (filters !== undefined) {
      const sanitizedFilters = {
        lotSqftMin: typeof filters.lotSqftMin === 'number' ? filters.lotSqftMin : null,
        lotSqftMax: typeof filters.lotSqftMax === 'number' ? filters.lotSqftMax : null,
        buildingSqftMin: typeof filters.buildingSqftMin === 'number' ? filters.buildingSqftMin : null,
        buildingSqftMax: typeof filters.buildingSqftMax === 'number' ? filters.buildingSqftMax : null,
        buildingClassCodes: Array.isArray(filters.buildingClassCodes) ? filters.buildingClassCodes.filter((c: any) => typeof c === 'string') : [],
        conditionGrades: Array.isArray(filters.conditionGrades) ? filters.conditionGrades.filter((c: any) => typeof c === 'string') : [],
      };

      const existingFilterSetting = await db.select().from(ingestionSettings).where(eq(ingestionSettings.key, 'ingestion_filters'));
      
      if (existingFilterSetting.length > 0) {
        await db.update(ingestionSettings)
          .set({ 
            value: sanitizedFilters, 
            updatedAt: new Date(),
            updatedByUserId: userId 
          })
          .where(eq(ingestionSettings.key, 'ingestion_filters'));
      } else {
        await db.insert(ingestionSettings).values({
          key: 'ingestion_filters',
          value: sanitizedFilters,
          description: 'Property filters for ingestion (lot size, building sqft, class, condition)',
          updatedByUserId: userId,
        });
      }
    }

    const updatedSettings = await db.select().from(ingestionSettings);
    const settingsMap: Record<string, unknown> = {};
    for (const setting of updatedSettings) {
      settingsMap[setting.key] = setting.value;
    }

    const updatedFilters = settingsMap.ingestion_filters as typeof DEFAULT_SETTINGS.filters | undefined;

    return NextResponse.json({
      success: true,
      zipCodes: (settingsMap.zip_codes as string[]) || DEFAULT_SETTINGS.zip_codes,
      defaultLimit: (settingsMap.default_limit as number) || DEFAULT_SETTINGS.default_limit,
      allZips: settingsMap.all_zips === true ? true : DEFAULT_SETTINGS.all_zips,
      filters: updatedFilters || DEFAULT_SETTINGS.filters,
    });
  } catch (error) {
    console.error('[IngestionSettings] Error updating settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
