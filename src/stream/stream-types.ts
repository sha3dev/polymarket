import type { OrderBook } from "../markets/market-types.ts";

export type MarketEventBase = { source: "polymarket"; assetId: string; index: number; date: Date };

export type MarketPriceEvent = MarketEventBase & { type: "price"; price: number };

export type MarketBookEvent = MarketEventBase & { type: "book" } & OrderBook;

export type MarketEvent = MarketPriceEvent | MarketBookEvent;

export type ConnectMarketStreamOptions = { reconnectDelayMs?: number };

export type SubscribeMarketAssetsOptions = { assetIds: string[] };

export type UnsubscribeMarketAssetsOptions = { assetIds: string[] };

export type AddMarketListenerOptions = { listener: (event: MarketEvent) => void };

export type GetAssetPriceOptions = { assetId: string };

export type GetAssetOrderBookOptions = { assetId: string };
