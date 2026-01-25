import { runMVPIngestion, MVP_ZIP_CODE } from '../src/lib/ingestion';

async function main() {
  console.log('=== MVP PROPERTY INGESTION ===');
  console.log(`Target ZIP Code: ${MVP_ZIP_CODE}`);
  console.log('');
  
  try {
    const stats = await runMVPIngestion(MVP_ZIP_CODE);
    
    console.log('\n=== INGESTION COMPLETE ===');
    console.log(`Duration: ${stats.durationMs ? Math.round(stats.durationMs / 1000) : 0} seconds`);
    console.log('');
    console.log('Statistics:');
    console.log(`  Parcels from Snowflake: ${stats.totalParcelsFromSnowflake}`);
    console.log(`  Properties after aggregation: ${stats.totalPropertiesAfterAggregation}`);
    console.log(`  Commercial/Multifamily identified: ${stats.commercialPropertiesIdentified}`);
    console.log(`  Enriched with POI data: ${stats.propertiesEnrichedWithPOI}`);
    console.log(`  Properties saved: ${stats.propertiesSaved}`);
    console.log(`  Parcels linked: ${stats.parcelsLinked}`);
    console.log(`  Errors: ${stats.errors}`);
    
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();
