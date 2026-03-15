// ============================================================================
// Default Market Registrations
//
// Registers built-in markets on module load. Import this file once at app
// startup (or it will be imported transitively by the pipeline).
// ============================================================================

import { registerMarket } from './registry';

// Dallas-Fort Worth metro — 4 county appraisal districts
registerMarket({
  id: 'dallas-tx',
  state: 'TX',
  defaultCity: 'Dallas',
  counties: ['DCAD', 'TAD', 'CCAD', 'DENT'],
  sosLabel: 'TX Secretary of State',
  sosSearchUrl: 'https://mycpa.cpa.state.tx.us/coa/',
  pdlRegion: 'texas',
  centerLatLng: [32.7767, -96.7970],
  residentialEnabled: true,
});

// Houston metro — Harris + Chambers (Phase 1-2)
registerMarket({
  id: 'houston-tx',
  state: 'TX',
  defaultCity: 'Houston',
  counties: ['HCAD', 'CHAM'],
  sosLabel: 'TX Secretary of State',
  sosSearchUrl: 'https://mycpa.cpa.state.tx.us/coa/',
  pdlRegion: 'texas',
  centerLatLng: [29.7604, -95.3698],
  residentialEnabled: false,
});
