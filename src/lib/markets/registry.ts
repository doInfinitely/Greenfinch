// ============================================================================
// Market Registry
//
// Central registry for market configurations. Markets can be registered
// programmatically via registerMarket() or loaded from markets-config.json.
// ============================================================================

import type { MarketConfig } from './types';
import type { CountyCode } from '../cad/types';

const markets = new Map<string, MarketConfig>();
const countyToMarket = new Map<CountyCode, string>();

/**
 * Register a market configuration. Also indexes all its counties for
 * reverse lookup via getMarketForCounty().
 */
export function registerMarket(config: MarketConfig): void {
  markets.set(config.id, config);
  for (const county of config.counties) {
    countyToMarket.set(county, config.id);
  }
}

/** Get a market by its ID, or null if not registered. */
export function getMarket(id: string): MarketConfig | null {
  return markets.get(id) ?? null;
}

/** Get the market that contains a given county code. */
export function getMarketForCounty(code: CountyCode): MarketConfig | null {
  const marketId = countyToMarket.get(code);
  if (!marketId) return null;
  return markets.get(marketId) ?? null;
}

/** Get all registered markets. */
export function getAllMarkets(): MarketConfig[] {
  return Array.from(markets.values());
}

/** Check if a market is registered. */
export function hasMarket(id: string): boolean {
  return markets.has(id);
}
