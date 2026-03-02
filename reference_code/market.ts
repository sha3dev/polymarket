/**
 * Module Overview
 * File: src/lib/market.ts
 * Purpose: Modela y carga mercados up/down desde Polymarket.
 * Role: Gestiona suscripcion y ciclo de ventana por mercado.
 */
/**
 * imports: externals
 */

/**
 * imports: internals
 */

import type { Market as MarketType } from "./market/market.type";
import MarketChannel from "./market/market.channel";
import { logger } from "../init";
import utils, { CryptoSymbols, type CryptoSymbol } from "./utils";

/**
 * consts
 */

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const MAX_NUMBER_OF_ERRORS_ALLOWED_BY_WINDOW = 20;
const SLEEP_WHEN_ERROR_MS = 1_000;

/**
 * types
 */

export type CryptoMarket = "15m" | "5m";
type LoopOptions = { minIntervalMs: number };

/**
 * state
 */

/**
 * class
 */

export default class Market {
  /**
   * private: attributes
   */

  private basePrice: number | null = null;

  /**
   * private: methods
   */

  private static getCryptoMarketSlugs(date: Date, cryptoMarket: CryptoMarket) {
    const windowMinutes = cryptoMarket === "15m" ? 15 : 5;
    const slugs = CryptoSymbols.map(symbol => {
      const slugParts = [symbol, "updown", cryptoMarket];
      const currentMinute = date.getUTCMinutes();
      const windowStartMinute = Math.floor(currentMinute / windowMinutes) * windowMinutes;
      const startWindowDate = new Date(date);
      startWindowDate.setUTCMinutes(windowStartMinute);
      startWindowDate.setUTCSeconds(0);
      startWindowDate.setUTCMilliseconds(0);
      const startWindowTimestamp = Math.floor(startWindowDate.getTime() / 1000);
      slugParts.push(startWindowTimestamp.toString());
      return slugParts.join("-");
    });
    return slugs;
  }

  private static async load(slug: string) {
    const url = utils.buildUrl(GAMMA_BASE_URL, `/markets/slug/${slug}`);
    logger.debug(`[MARKET] Getting market: ${url.toString()}`);
    const response = await fetch(url.toString(), { method: "GET" });
    if (response.ok) {
      const data = await response.json();
      const symbol = data.slug.slice(0, 3)?.toLowerCase();
      data.symbol = CryptoSymbols.includes(symbol) ? symbol : null;
      data.clobTokenIds = data.clobTokenIds ? JSON.parse(data.clobTokenIds) : [];
      data.outcomes = data.outcomes ? JSON.parse(data.outcomes) : [];
      data.start = new Date(data.eventStartTime);
      data.end = new Date(data.endDate);
      data.orderMinSize = Number(data.orderMinSize || 0);
      const upTokenIndex = data.outcomes.findIndex((o: string) => o.toLowerCase() === "up");
      if (upTokenIndex < 0) {
        throw new Error(`Token up from market ${data.slug} not found`);
      }
      data.upTokenId = data.clobTokenIds[upTokenIndex];
      const downTokenIndex = data.outcomes.findIndex((o: string) => o.toLowerCase() === "down");
      if (downTokenIndex < 0) {
        throw new Error(`Token down from market ${data.slug} not found`);
      }
      data.downTokenId = data.clobTokenIds[downTokenIndex];
      return data as MarketType;
    }
    logger.warn(`[MARKET] Failed to get market: ${response.status} ${response.statusText}`);
    return null;
  }

  /**
   * constructor
   */

  constructor(
    private market: MarketType,
    private cryptoMarket: CryptoMarket,
  ) {}

  /**
   * public: properties
   */

  public get Slug() {
    return this.market.slug;
  }

  public get Symbol(): CryptoSymbol {
    return this.market.symbol;
  }

  public get OrderMinSize() {
    return this.market.orderMinSize;
  }

  public get TickSize() {
    return this.market.orderPriceMinTickSize ? Number(this.market.orderPriceMinTickSize) : 0;
  }

  public get UpTokenId() {
    return this.market.upTokenId;
  }

  public get DownTokenId() {
    return this.market.downTokenId;
  }

  public get StartWindow() {
    return this.market.start;
  }

  public get EndWindow() {
    return this.market.end;
  }

  public get UpPrice() {
    const up = MarketChannel.getAssetPrice(this.market.upTokenId);
    return up;
  }

  public get DownPrice() {
    const down = MarketChannel.getAssetPrice(this.market.downTokenId);
    return down;
  }

  public get BasePrice() {
    if (!this.basePrice) {
      throw new Error(`[MARKET] base price is not set for market ${this.market.slug}`);
    }
    return this.basePrice;
  }

  public get CryptoMarket() {
    return this.cryptoMarket;
  }

  public get UpBestAsk() {
    const upBook = MarketChannel.getAssetOrderBook(this.market.upTokenId);
    return upBook ? upBook.asks?.[0]?.price : null;
  }

  public get UpOrderBook() {
    return MarketChannel.getAssetOrderBook(this.market.upTokenId) ?? null;
  }

  public get UpBestBid() {
    const upBook = MarketChannel.getAssetOrderBook(this.market.upTokenId);
    return upBook ? upBook.bids?.[0]?.price : null;
  }

  public get DownBestAsk() {
    const downBook = MarketChannel.getAssetOrderBook(this.market.downTokenId);
    return downBook ? downBook.asks?.[0]?.price : null;
  }

  public get DownOrderBook() {
    return MarketChannel.getAssetOrderBook(this.market.downTokenId) ?? null;
  }

  public get DownBestBid() {
    const downBook = MarketChannel.getAssetOrderBook(this.market.downTokenId);
    return downBook ? downBook.bids?.[0]?.price : null;
  }

  /**
   * public: methods
   */

  public async loop(loopCallback: (index: number) => Promise<void | "EXIT" | "WAIT">, options: LoopOptions) {
    const { end } = this.market;
    const endMs = end.getTime();
    let running = true;
    // logger.debug(`[MARKET] Starting loop for ${this.market.symbol} (scheduled end at ${end.toISOString()})`);
    const timeoutId = setTimeout(
      () => {
        running = false;
      },
      Math.max(endMs - Date.now(), 0),
    );
    try {
      let i = 0;
      let errors = 0;
      while (running) {
        try {
          const t0 = Date.now();
          const result = await loopCallback(i);
          if (result === "EXIT") {
            break;
          }
          if (result === "WAIT") {
            logger.warn(`[MARKET ${this.market.symbol} is waiting until end of window...`);
          }
          errors = 0;
          i += 1;
          const t1 = Date.now();
          const timeToWait = options.minIntervalMs - (t1 - t0);
          if (timeToWait > 0) {
            await utils.sleep(timeToWait);
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          logger.error(`[MARKET] Error in loop of ${this.market.slug}: ${err.message}`);
          errors += 1;
          if (errors >= MAX_NUMBER_OF_ERRORS_ALLOWED_BY_WINDOW) {
            logger.warn(`[MARKET] ${errors} consecutive errors in the same window. Sleeping until the next window starts (${end})`);
            await utils.sleep(Math.max(endMs - Date.now(), 0));
          } else {
            logger.debug(`[MARKET] Sleeping ${SLEEP_WHEN_ERROR_MS}ms`);
            await utils.sleep(SLEEP_WHEN_ERROR_MS);
          }
        } finally {
          if (Date.now() > endMs) {
            running = false;
          }
        }
      }
    } finally {
      // logger.debug(`[MARKET] Loop finished for ${this.market.symbol}`);
      clearTimeout(timeoutId);
    }
  }

  public async subscribe() {
    logger.debug(`[MARKET] Subscribing to market ${this.market.slug}`);
    MarketChannel.subscribe(this.market.clobTokenIds);
  }

  public async unsubscribe() {
    logger.debug(`Unsubscribing from market ${this.market.slug}`);
    MarketChannel.unsubscribe(this.market.clobTokenIds);
  }

  /**
   * public static: methods
   */

  public static connect() {
    MarketChannel.connect();
  }

  public static async loadCryptoMarkets(cryptoMarket: CryptoMarket) {
    const now = new Date();
    const slugs = this.getCryptoMarketSlugs(now, cryptoMarket);
    const markets = await Promise.all(Array.from(slugs).map(i => this.load(i)));
    const validMarkets = markets.filter((m): m is MarketType => m !== null);
    if (validMarkets.length) {
      const start = validMarkets[0]!.start;
      const end = validMarkets[0]!.end;
      return { markets: validMarkets.map(m => new Market(m, cryptoMarket)), start, end };
    }
    throw new Error(`No markets found for this date: ${now}`);
  }

  public toJSON() {
    return this.market;
  }
}
