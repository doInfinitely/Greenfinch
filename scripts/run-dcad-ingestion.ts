import { runIngestion } from '../src/lib/dcad-ingestion';

async function main() {
  console.log('Starting DCAD-based ingestion for ZIP 75225...');
  const stats = await runIngestion('75225', 500);
  console.log('Ingestion complete:', stats);
}

main().catch(console.error);
