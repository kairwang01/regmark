// The fixture shop's public surface: the data, the two shop modes, and the servers.

export { buildShop } from './shop.ts';
export type { Shop, ProductSays, VariantSays, CheckoutTruth, FeedGhost, ExpectedFinding, Defect, Stock } from './shop.ts';
export { CATALOG, CURRENCY, OWNERSHIP_TOKEN, RETURN_DAYS, SHIPPING } from './catalog.ts';
export type { TruthProduct, TruthVariant } from './catalog.ts';
export { startShop } from './server.ts';
export type { RunningShop, StartOptions } from './server.ts';
export { createStoreApi } from './store-api.ts';
export type { ApiRequest, ApiResponse, CartSnapshot, StoreApi } from './store-api.ts';
