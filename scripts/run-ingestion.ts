import { runMultiZipIngestion } from '../src/lib/dcad-ingestion';
import { MVP_ZIP_CODES } from '../src/lib/constants';

async function main() {
  console.log(`Starting ingestion for ${MVP_ZIP_CODES.length} MVP ZIP codes: ${MVP_ZIP_CODES.join(', ')}`);
  
  try {
    const stats = await runMultiZipIngestion(MVP_ZIP_CODES, 500);
    console.log('\n=== Ingestion Complete ===');
    console.log('Stats:', JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();
