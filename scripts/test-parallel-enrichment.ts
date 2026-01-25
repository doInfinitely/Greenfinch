import { db } from '../src/lib/db';
import { properties, contacts, organizations, propertyContacts, propertyOrganizations } from '../src/lib/schema';
import { startBatch, getQueueStatus } from '../src/lib/enrichment-queue';
import { eq, isNull, or } from 'drizzle-orm';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Testing Parallel Enrichment ===\n');
  
  // Get count of unenriched properties
  const unenrichedProps = await db.query.properties.findMany({
    where: or(
      isNull(properties.enrichmentStatus),
      eq(properties.enrichmentStatus, 'pending')
    ),
    columns: { id: true, propertyKey: true },
  });
  
  console.log(`Found ${unenrichedProps.length} unenriched properties`);
  
  if (unenrichedProps.length === 0) {
    console.log('No properties to enrich. Checking if we should reset enrichment status...');
    
    // Count all properties
    const allProps = await db.select({ count: properties.id }).from(properties);
    console.log(`Total properties in database: ${allProps.length}`);
    
    // Reset enrichment status for testing
    console.log('\nResetting enrichment status for all properties...');
    await db.update(properties).set({ enrichmentStatus: 'pending' });
    console.log('Done. Re-run the script to test enrichment.');
    return;
  }
  
  const testLimit = Math.min(20, unenrichedProps.length);
  const concurrency = 20; // Higher concurrency for Gemini Flash
  
  console.log(`\nStarting batch enrichment:`);
  console.log(`  - Properties: ${testLimit}`);
  console.log(`  - Concurrency: ${concurrency}`);
  console.log('');
  
  const startTime = Date.now();
  
  try {
    const batch = await startBatch({
      onlyUnenriched: true,
      limit: testLimit,
      concurrency,
    });
    
    console.log(`Batch started: ${batch.batchId}`);
    console.log(`Status: ${batch.status}`);
    console.log('');
    
    // Poll for completion
    let lastProcessed = 0;
    while (true) {
      await sleep(2000);
      
      const status = getQueueStatus();
      if (!status) {
        console.log('Queue status not available');
        break;
      }
      
      const { progress } = status;
      
      if (progress.processed !== lastProcessed) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const ppm = progress.propertiesPerMinute || 0;
        const eta = progress.estimatedSecondsRemaining;
        const etaStr = eta ? `ETA: ${Math.round(eta / 60)}m ${eta % 60}s` : '';
        
        console.log(`[${elapsed}s] Progress: ${progress.processed}/${progress.total} (${progress.succeeded} ok, ${progress.failed} failed) | ${ppm}/min | ${etaStr}`);
        lastProcessed = progress.processed;
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        console.log('');
        console.log(`=== Batch ${status.status.toUpperCase()} ===`);
        console.log(`  Total: ${progress.total}`);
        console.log(`  Succeeded: ${progress.succeeded}`);
        console.log(`  Failed: ${progress.failed}`);
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const avgTime = (parseFloat(totalTime) / progress.total).toFixed(2);
        console.log(`  Total time: ${totalTime}s`);
        console.log(`  Avg per property: ${avgTime}s`);
        console.log(`  Rate: ${progress.propertiesPerMinute || 0}/min`);
        
        if (status.errors.length > 0) {
          console.log('');
          console.log('Errors:');
          status.errors.slice(0, 5).forEach(e => {
            console.log(`  - ${e.propertyKey}: ${e.error}`);
          });
          if (status.errors.length > 5) {
            console.log(`  ... and ${status.errors.length - 5} more`);
          }
        }
        
        break;
      }
    }
  } catch (error) {
    console.error('Error starting batch:', error);
  }
}

main().catch(console.error);
