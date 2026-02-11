import { runMultiZipIngestion, runAllZipsIngestion } from '../src/lib/dcad-ingestion';
import { MVP_ZIP_CODES } from '../src/lib/constants';

const useAllZips = process.argv.includes('--all');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 500;

async function main() {
  if (useAllZips) {
    console.log(`Starting ingestion for ALL ZIP codes with limit ${limit}`);
    try {
      const stats = await runAllZipsIngestion(limit);
      console.log('\n=== Ingestion Complete ===');
      console.log('Stats:', JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('Ingestion failed:', error);
      process.exit(1);
    }
  } else {
    console.log(`Starting ingestion for ${MVP_ZIP_CODES.length} MVP ZIP codes: ${MVP_ZIP_CODES.join(', ')}`);
    try {
      const stats = await runMultiZipIngestion(MVP_ZIP_CODES, limit);
      console.log('\n=== Ingestion Complete ===');
      console.log('Stats:', JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('Ingestion failed:', error);
      process.exit(1);
    }
  }
}

main();
