export { PolymarketClient } from "./client/polymarket-client.ts";
export type { PolymarketClientOptions } from "./client/polymarket-client.ts";

export { GammaMarketCatalogService, MarketLoadError, MarketNormalizationError } from "./markets/index.ts";
export type {
  BuildCryptoWindowSlugsOptions,
  CryptoMarketWindow,
  CryptoSymbol,
  LoadCryptoWindowMarketsOptions,
  LoadMarketBySlugOptions,
  LoadMarketsBySlugsOptions,
  OrderBook,
  OrderBookLevel,
  PolymarketMarket
} from "./markets/index.ts";

export { MarketStreamService, MarketStreamConnectionError, MarketStreamProtocolError } from "./stream/index.ts";
export type {
  AddMarketListenerOptions,
  ConnectMarketStreamOptions,
  GetAssetOrderBookOptions,
  GetAssetPriceOptions,
  MarketBookEvent,
  MarketEvent,
  MarketPriceEvent,
  SubscribeMarketAssetsOptions,
  UnsubscribeMarketAssetsOptions
} from "./stream/index.ts";

export {
  OrderService,
  OrderClientInitializationError,
  OrderPlacementError,
  OrderConfirmationTimeoutError,
  OrderConfirmationFailedError
} from "./orders/index.ts";
export type {
  ClobApiKeyCreds,
  Direction,
  ExecutionType,
  InitializeOrderServiceOptions,
  Operation,
  OrderStatus,
  PostOrderOptions,
  PostedOrder,
  PostedOrderWithStatus,
  WaitForOrderConfirmationOptions
} from "./orders/index.ts";

export { PolymarketError } from "./shared/polymarket-error.ts";
