/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { decodeWsMessage, isRecord } from "../shared/utils.ts";
import type { MarketBookEvent, MarketEvent, MarketPriceEvent } from "./stream-types.ts";
import { MarketStreamProtocolError } from "./market-stream-protocol-error.ts";

/**
 * @section consts
 */

const HEARTBEAT_PONG_MESSAGE = "PONG";

/**
 * @section types
 */

type BookPayload = {
  event_type: "book";
  asset_id: string;
  timestamp: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
};

type LastTradePayload = { event_type: "last_trade_price"; asset_id: string; timestamp: string; price: string };

type SupportedPayload = BookPayload | LastTradePayload;

export class MarketStreamParser {
  /**
   * @section private:attributes
   */

  // empty

  /**
   * @section protected:attributes
   */

  // empty

  /**
   * @section private:properties
   */

  private readonly messageIndexByAssetId: Map<string, number>;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor() {
    this.messageIndexByAssetId = new Map<string, number>();
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): MarketStreamParser {
    const parser = new MarketStreamParser();
    return parser;
  }

  /**
   * @section private:methods
   */

  private getIndex(assetId: string): number {
    const previous = this.messageIndexByAssetId.get(assetId) ?? 0;
    const current = previous + 1;
    this.messageIndexByAssetId.set(assetId, current);
    return current;
  }

  private asPayloads(raw: unknown): SupportedPayload[] {
    const collection = Array.isArray(raw) ? raw : [raw];
    const payloads = collection.filter((item) => {
      return isRecord(item) && typeof item.event_type === "string" && typeof item.asset_id === "string";
    }) as SupportedPayload[];
    return payloads;
  }

  private toBookEvent(payload: BookPayload): MarketBookEvent {
    const bids = (payload.bids ?? []).map((bid) => {
      return { price: Number(bid.price), size: Number(bid.size) };
    });
    const asks = (payload.asks ?? []).map((ask) => {
      return { price: Number(ask.price), size: Number(ask.size) };
    });
    bids.sort((left, right) => {
      return right.price - left.price;
    });
    asks.sort((left, right) => {
      return left.price - right.price;
    });
    const event: MarketBookEvent = {
      source: "polymarket",
      type: "book",
      assetId: payload.asset_id,
      index: this.getIndex(payload.asset_id),
      date: new Date(Number(payload.timestamp)),
      bids,
      asks
    };
    return event;
  }

  private toPriceEvent(payload: LastTradePayload): MarketPriceEvent {
    const event: MarketPriceEvent = {
      source: "polymarket",
      type: "price",
      assetId: payload.asset_id,
      index: this.getIndex(payload.asset_id),
      date: new Date(Number(payload.timestamp)),
      price: Number(payload.price)
    };
    return event;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public parse(rawMessage: unknown): MarketEvent[] {
    const text = decodeWsMessage(rawMessage);
    const isHeartbeatPong = text.trim() === HEARTBEAT_PONG_MESSAGE;
    const events: MarketEvent[] = [];
    if (!isHeartbeatPong) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw MarketStreamProtocolError.forMessage("payload is not valid JSON", text);
      }
      const payloads = this.asPayloads(parsed);
      for (const payload of payloads) {
        if (payload.event_type === "book") {
          events.push(this.toBookEvent(payload));
        }
        if (payload.event_type === "last_trade_price") {
          events.push(this.toPriceEvent(payload));
        }
      }
    }
    return events;
  }

  /**
   * @section static:methods
   */

  // empty
}
