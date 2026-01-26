import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { sql, eq } from 'drizzle-orm';

export async function GET() {
  try {
    // Get distinct categories
    const categoriesResult = await db.execute(
      sql`SELECT DISTINCT asset_category FROM ${properties} WHERE asset_category IS NOT NULL AND is_active = true ORDER BY asset_category`
    );
    const categories = (categoriesResult.rows as { asset_category: string }[])
      .map(r => r.asset_category)
      .filter(Boolean);

    // Get distinct subcategories
    const subcategoriesResult = await db.execute(
      sql`SELECT DISTINCT asset_subcategory FROM ${properties} WHERE asset_subcategory IS NOT NULL AND is_active = true ORDER BY asset_subcategory`
    );
    const subcategories = (subcategoriesResult.rows as { asset_subcategory: string }[])
      .map(r => r.asset_subcategory)
      .filter(Boolean);

    // Get distinct building classes
    const buildingClassesResult = await db.execute(
      sql`SELECT DISTINCT calculated_building_class FROM ${properties} WHERE calculated_building_class IS NOT NULL AND is_active = true ORDER BY calculated_building_class`
    );
    const buildingClasses = (buildingClassesResult.rows as { calculated_building_class: string }[])
      .map(r => r.calculated_building_class)
      .filter(Boolean);

    // Get distinct AC types
    const acTypesResult = await db.execute(
      sql`SELECT DISTINCT dcad_primary_ac_type FROM ${properties} WHERE dcad_primary_ac_type IS NOT NULL AND is_active = true ORDER BY dcad_primary_ac_type`
    );
    const acTypes = (acTypesResult.rows as { dcad_primary_ac_type: string }[])
      .map(r => r.dcad_primary_ac_type)
      .filter(Boolean);

    // Get distinct heating types
    const heatingTypesResult = await db.execute(
      sql`SELECT DISTINCT dcad_primary_heating_type FROM ${properties} WHERE dcad_primary_heating_type IS NOT NULL AND is_active = true ORDER BY dcad_primary_heating_type`
    );
    const heatingTypes = (heatingTypesResult.rows as { dcad_primary_heating_type: string }[])
      .map(r => r.dcad_primary_heating_type)
      .filter(Boolean);

    return NextResponse.json({
      categories,
      subcategories,
      buildingClasses,
      acTypes,
      heatingTypes,
    });
  } catch (error) {
    console.error('[API] Filter options error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch filter options' },
      { status: 500 }
    );
  }
}
