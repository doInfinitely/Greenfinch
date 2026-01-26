import { runMultiZipIngestion } from '../src/lib/dcad-ingestion';
import { MVP_ZIP_CODES } from '../src/lib/constants';

async function main() {
  console.log(`Starting DCAD-based ingestion for ${MVP_ZIP_CODES.length} ZIP codes: ${MVP_ZIP_CODES.join(', ')}`);
  const stats = await runMultiZipIngestion(MVP_ZIP_CODES, 500);
  console.log('Ingestion complete:', stats);
}

main().catch(console.error);
