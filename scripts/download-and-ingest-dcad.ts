/**
 * DCAD-specific wrapper for the generalized CAD ingestion script.
 * Kept for backwards compatibility.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/download-and-ingest-dcad.ts [--zip ZIPCODE] [--limit N] [--skip-download]
 *
 * This is equivalent to:
 *   npx tsx --env-file=.env.local scripts/download-and-ingest-cad.ts --county DCAD [--zip ZIPCODE] [--limit N] [--skip-download]
 */

// Inject --county DCAD into argv if not already present
if (!process.argv.includes('--county')) {
  process.argv.splice(2, 0, '--county', 'DCAD');
}

import('./download-and-ingest-cad');
