// ============================================================================
// Market Configuration Types
//
// Defines the shape of a market — a geographic region (metro area) with its
// counties, default geography, and pipeline parameters. Adding a new market
// requires only a JSON entry in markets-config.json plus a county CAD parser.
// ============================================================================

import type { CountyCode } from '../cad/types';

export interface MarketConfig {
  /** Unique market identifier, e.g. 'dallas-tx' */
  id: string;

  /** Two-letter state code, e.g. 'TX' */
  state: string;

  /** Default city used when property city is missing, e.g. 'Dallas' */
  defaultCity: string;

  /** County codes included in this market */
  counties: CountyCode[];

  /** Secretary of State label used in ownership prompts, e.g. 'TX Secretary of State' */
  sosLabel: string;

  /** Secretary of State search URL for entity lookup */
  sosSearchUrl: string;

  /** PDL region parameter for person enrichment, e.g. 'texas' */
  pdlRegion: string;

  /** Map center coordinates [lat, lng] */
  centerLatLng: [number, number];

  /** Whether residential property enrichment is enabled for this market */
  residentialEnabled: boolean;
}
