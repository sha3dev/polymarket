/**
 * @section imports:internals
 */

import { NumberNormalizerService } from "../shared/number-normalizer.service.ts";
import type { OrderBookLevel } from "../market/market.types.ts";
import type { MarketBookEvent, MarketEvent, MarketPriceEvent } from "./stream.types.ts";

/**
 * @section types
 */

type RawBookLevel = { price?: string; size?: string };

type RawStreamEvent = {
  event_type?: string;
  asset_id?: string;
  timestamp?: string;
  price?: string;
  bids?: RawBookLevel[];
  asks?: RawBookLevel[];
};

export class MarketStreamParserService {
  /**
   * @section private:properties
   */

  private readonly numberNormalizer: NumberNormalizerService;

  /**
   * @section constructor
   */

  public constructor(numberNormalizer?: NumberNormalizerService) {
    this.numberNormalizer = numberNormalizer ?? NumberNormalizerService.create();
  }

  /**
   * @section factory
   */

  public static create(): MarketStreamParserService {
    const service = new MarketStreamParserService();
    return service;
  }

  /**
   * @section private:methods
   */

  private parseJson(payload: string): unknown {
    let parsedPayload: unknown = [];
    if (payload === "PONG") {
      parsedPayload = [];
    }
    if (payload !== "PONG") {
      try {
        parsedPayload = JSON.parse(payload) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse market stream payload: ${reason}`);
      }
    }
    return parsedPayload;
  }

  private normalizeEntries(payload: unknown): RawStreamEvent[] {
    const entries = Array.isArray(payload) ? payload : [payload];
    const normalizedEntries = entries.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as RawStreamEvent[];
    return normalizedEntries;
  }

  private buildBaseEvent(entry: RawStreamEvent, index: number): { assetId: string; date: Date; index: number; source: "polymarket" } | null {
    const hasIdentifiers = typeof entry.asset_id === "string" && typeof entry.timestamp === "string";
    const assetId = hasIdentifiers ? entry.asset_id! : "";
    const timestamp = hasIdentifiers ? entry.timestamp! : "";
    const baseEvent = hasIdentifiers ? { assetId, date: new Date(Number(timestamp)), index, source: "polymarket" as const } : null;
    return baseEvent;
  }

  private readBookLevels(levels: RawBookLevel[] | undefined, isBidSide: boolean): OrderBookLevel[] {
    const unsortedLevels = Array.isArray(levels)
      ? levels
          .filter((level) => typeof level.price === "string" && typeof level.size === "string")
          .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
          .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
      : [];
    const sortedLevels = unsortedLevels.sort((leftLevel, rightLevel) => (isBidSide ? rightLevel.price - leftLevel.price : leftLevel.price - rightLevel.price));
    return sortedLevels;
  }

  private buildPriceEvent(entry: RawStreamEvent, index: number): MarketPriceEvent | null {
    const baseEvent = this.buildBaseEvent(entry, index);
    const numericPrice = typeof entry.price === "string" ? Number(entry.price) : Number.NaN;
    const priceEvent =
      baseEvent && Number.isFinite(numericPrice) ? { ...baseEvent, type: "price" as const, price: this.numberNormalizer.round(numericPrice, 8) } : null;
    return priceEvent;
  }

  private buildBookEvent(entry: RawStreamEvent, index: number): MarketBookEvent | null {
    const baseEvent = this.buildBaseEvent(entry, index);
    const bookEvent = baseEvent ? { ...baseEvent, type: "book" as const, bids: this.readBookLevels(entry.bids, true), asks: this.readBookLevels(entry.asks, false) } : null;
    return bookEvent;
  }

  private buildEvent(entry: RawStreamEvent, index: number): MarketEvent | null {
    let event: MarketEvent | null = null;
    if (entry.event_type === "last_trade_price") {
      event = this.buildPriceEvent(entry, index);
    }
    if (entry.event_type === "book") {
      event = this.buildBookEvent(entry, index);
    }
    return event;
  }

  /**
   * @section public:methods
   */

  public parse(payload: unknown): MarketEvent[] {
    const textPayload = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
    const parsedPayload = this.parseJson(textPayload);
    const entries = this.normalizeEntries(parsedPayload);
    const events = entries.map((entry, index) => this.buildEvent(entry, index + 1)).filter((event): event is MarketEvent => event !== null);
    return events;
  }
}
