// The fixture shop's public surface: the data, the two shop modes, and the servers.

export { AGENT_ONLY_REVIEW, AGENT_TOKENS, buildShop, clientOf } from './shop.ts';
export type { Client, Shop, ProductSays, VariantSays, CheckoutTruth, FeedGhost, ExpectedFinding, Defect, Stock } from './shop.ts';
export { CATALOG, CURRENCY, OWNERSHIP_TOKEN, RETURN_DAYS, SHIPPING } from './catalog.ts';
export type { TruthProduct, TruthVariant } from './catalog.ts';
export { startShop } from './server.ts';
export type { RunningShop, StartOptions } from './server.ts';
export { createStoreApi } from './store-api.ts';
export type { ApiRequest, ApiResponse, CartSnapshot, StoreApi } from './store-api.ts';
