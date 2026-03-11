import { runIngestion } from '../src/lib/dcad-ingestion';

const MVP_ZIP_CODE = process.env.MVP_ZIP || '75225';

async function main() {
  console.log('=== COMMERCIAL PROPERTY INGESTION (DCAD + Regrid) ===');
  console.log(`Target ZIP Code: ${MVP_ZIP_CODE}`);
  console.log('');
  
  try {
    const stats = await runIngestion(MVP_ZIP_CODE, 500);
    
    console.log('\n=== INGESTION COMPLETE ===');
    console.log(`Duration: ${Math.round(stats.durationMs / 1000)} seconds`);
    console.log('');
    console.log('Statistics:');
    console.log(`  Properties from staging: ${stats.totalFromStaging}`);
    console.log(`  New properties saved: ${stats.propertiesSaved}`);
    console.log(`  Existing properties updated: ${stats.propertiesUpdated}`);
    console.log(`  Errors: ${stats.errors}`);
    
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();
