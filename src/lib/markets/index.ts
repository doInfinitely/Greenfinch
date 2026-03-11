export type { MarketConfig } from './types';
export { registerMarket, getMarket, getMarketForCounty, getAllMarkets, hasMarket } from './registry';

// Auto-register built-in markets
import './defaults';
