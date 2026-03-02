/**
 * Module Overview
 * File: src/lib/market/market.channel.ts
 * Purpose: Gestiona websocket de mercado CLOB de Polymarket.
 * Role: Mantiene cache de precios y libros por assetId.
 */
/**
 * imports: externals
 */

import WebSocket, { type RawData } from "ws";

/**
 * imports: internal
 */

import type { Book } from "../utils";
import utils from "../utils";
import { logger } from "../../init";

/**
 * types
 */

type MarketMessageBase = { date: Date; assetId: string; source: "polymarket"; index: number };

type MarketBookMessage = MarketMessageBase & { type: "book" } & Book;

type MarketPriceMessage = MarketMessageBase & { type: "price"; price: number };

type MarketMessage = MarketBookMessage | MarketPriceMessage;

type ListenerCallback = (message: MarketMessage) => void;

type BookPayload = {
  event_type: "book";
  asset_id: string;
  timestamp: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
};

type LastTradePayload = {
  asset_id: string;
  event_type: "last_trade_price";
  timestamp: string;
  price: string;
};

/**
 * consts
 */

const WSS_BASE_URL = "wss://ws-subscriptions-clob.polymarket.com/ws";
const WSS_MARKET_CHANNEL_URL = `${WSS_BASE_URL}/market`;
const WSS_RECONNECT_DELAY_MS = 2_000;

/**
 * class
 */

export default abstract class {
  /**
   * private: attributes
   */

  private static messageIndex: Map<string, number> = new Map();
  private static listeners: Set<ListenerCallback> = new Set();
  private static ws: WebSocket;
  private static desiredClobTokenIds: string[] = [];
  private static subscribedClobTokenIds: string[] = [];
  private static lastAssetPrices: Map<string, number> = new Map();
  private static lastOrderBooks: Map<string, Book> = new Map();

  /**
   * private: methods
   */

  private static onOpen() {
    logger.debug(`[MARKET] Market WS opened`);
    this.subscribedClobTokenIds = [];
    this.flushSubscriptions();
  }

  private static async onClose() {
    logger.debug(`[MARKET] Market WS closed. Reconnecting...`);
    while (this.ws.readyState === WebSocket.CLOSED) {
      await this.connect();
      await utils.sleep(WSS_RECONNECT_DELAY_MS);
    }
  }

  private static onError(error: Error) {
    logger.error(`[MARKET] Market WS error: ${error.message}`);
  }

  private static onMessage(messageEvent: RawData) {
    const text = utils.decodeWsMessageEvent(messageEvent);
    if (utils.isValidJson(text)) {
      try {
        const rawMessage = JSON.parse(text);
        const messages: (BookPayload | LastTradePayload)[] = Array.isArray(rawMessage) ? rawMessage : [rawMessage];
        for (const message of messages) {
          try {
            const source = "polymarket" as const;
            const assetId = message.asset_id;
            const index = (this.messageIndex.get(assetId) || 0) + 1;
            const date = new Date(Number(message.timestamp));
            if (message.event_type === "book") {
              let bids = message.bids?.map(i => ({ price: Number(i.price), size: Number(i.size) })) || [];
              let asks = message.asks?.map(i => ({ price: Number(i.price), size: Number(i.size) })) || [];
              bids = bids.sort((a, b) => b.price - a.price);
              asks = asks.sort((a, b) => a.price - b.price);
              this.lastOrderBooks.set(assetId, { asks, bids });
              const marketMesage = { source, assetId, date, type: "book" as const, asks, bids, index };
              this.listeners.forEach(listener => listener(marketMesage));
            }
            if (message.event_type === "last_trade_price") {
              const price = Number(message.price);
              this.lastAssetPrices.set(assetId, price);
              const marketMesage = { source, assetId, date, type: "price" as const, price, index };
              this.listeners.forEach(listener => listener(marketMesage));
            }
            this.messageIndex.set(assetId, index);
          } catch (e) {
            logger.error(`[MARKET] Failed process market message: ${text} => ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (err) {
        logger.error(`[MARKET] Failed to parse Market WS message as JSON: ${text} => ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      logger.error(`[MARKET] Unexpected message: ${text}`);
    }
  }

  private static sendSubscriptionPayload(payload: unknown, context: string) {
    let result = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      result = true;
    } else {
      logger.warn(`[MARKET] Cannot send ${context} payload: WS is not open`);
    }
    return result;
  }

  private static flushSubscriptions() {
    const pendingTokenIds = this.desiredClobTokenIds.filter(id => !this.subscribedClobTokenIds.includes(id));
    if (pendingTokenIds.length > 0) {
      const payload = { type: "market", operation: "subscribe", assets_ids: pendingTokenIds, custom_feature_enabled: true };
      const sent = this.sendSubscriptionPayload(payload, "market-subscribe");
      if (sent) {
        this.subscribedClobTokenIds = [...this.subscribedClobTokenIds, ...pendingTokenIds];
      }
    }
  }

  /**
   * public: methods
   */

  public static async connect() {
    if (this.ws) {
      this.ws.close();
    }
    await new Promise<void>(resolve => {
      this.ws = new WebSocket(WSS_MARKET_CHANNEL_URL);
      this.ws.on("close", this.onClose.bind(this));
      this.ws.on("error", this.onError.bind(this));
      this.ws.on("message", this.onMessage.bind(this));
      this.ws.on("open", resolve);
    });
    this.onOpen();
  }

  public static subscribe(clobTokenIds: string[]) {
    const newDesiredTokenIds = clobTokenIds.filter(id => !this.desiredClobTokenIds.includes(id));
    if (newDesiredTokenIds.length > 0) {
      this.desiredClobTokenIds = [...newDesiredTokenIds, ...this.desiredClobTokenIds];
    }
    this.flushSubscriptions();
  }

  public static unsubscribe(clobTokenIds: string[]) {
    this.desiredClobTokenIds = this.desiredClobTokenIds.filter(i => !clobTokenIds.includes(i));
    const subscribedToRemove = this.subscribedClobTokenIds.filter(i => clobTokenIds.includes(i));
    if (subscribedToRemove.length > 0) {
      const payload = { type: "market", operation: "unsubscribe", assets_ids: subscribedToRemove, custom_feature_enabled: true };
      const sent = this.sendSubscriptionPayload(payload, "market-unsubscribe");
      if (sent) {
        this.subscribedClobTokenIds = this.subscribedClobTokenIds.filter(i => !subscribedToRemove.includes(i));
      }
    }
  }

  public static getAssetPrice(assetId: string) {
    return this.lastAssetPrices.get(assetId);
  }

  public static getAssetOrderBook(assetId: string) {
    return this.lastOrderBooks.get(assetId);
  }
}
