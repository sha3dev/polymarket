/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import { createDefaultClock, createDefaultLogger, createDefaultWebSocketFactory } from "../shared/defaults.ts";
import type { Clock, WebSocketFactory, WebSocketLike } from "../shared/contracts.ts";
import type {
  AddMarketListenerOptions,
  ConnectMarketStreamOptions,
  GetAssetOrderBookOptions,
  GetAssetPriceOptions,
  MarketEvent,
  SubscribeMarketAssetsOptions,
  UnsubscribeMarketAssetsOptions
} from "./stream-types.ts";
import { MarketStreamConnectionError } from "./market-stream-connection-error.ts";
import { MarketStreamParser } from "./market-stream-parser.ts";
import type { OrderBook } from "../markets/market-types.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

type MarketStreamServiceOptions = { readonly clock?: Clock; readonly webSocketFactory?: WebSocketFactory; readonly parser?: MarketStreamParser };

export class MarketStreamService {
  /**
   * @section private:attributes
   */

  private reconnectDelayMs: number;
  private isDisconnectRequested: boolean;

  /**
   * @section protected:attributes
   */

  // empty

  /**
   * @section private:properties
   */

  private readonly logger: ReturnType<typeof createDefaultLogger>;
  private readonly clock: Clock;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly parser: MarketStreamParser;
  private readonly listeners: Set<(event: MarketEvent) => void>;
  private readonly desiredAssetIds: Set<string>;
  private readonly subscribedAssetIds: Set<string>;
  private readonly lastPriceByAssetId: Map<string, number>;
  private readonly lastOrderBookByAssetId: Map<string, OrderBook>;
  private ws: WebSocketLike | null;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options?: MarketStreamServiceOptions) {
    this.logger = createDefaultLogger();
    this.clock = options?.clock ?? createDefaultClock();
    this.webSocketFactory = options?.webSocketFactory ?? createDefaultWebSocketFactory();
    this.parser = options?.parser ?? MarketStreamParser.create();
    this.listeners = new Set<(event: MarketEvent) => void>();
    this.desiredAssetIds = new Set<string>();
    this.subscribedAssetIds = new Set<string>();
    this.lastPriceByAssetId = new Map<string, number>();
    this.lastOrderBookByAssetId = new Map<string, OrderBook>();
    this.ws = null;
    this.reconnectDelayMs = CONFIG.DEFAULT_RECONNECT_DELAY_MS;
    this.isDisconnectRequested = false;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(options?: MarketStreamServiceOptions): MarketStreamService {
    const service = new MarketStreamService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private getEndpointUrl(): string {
    const endpoint = `${CONFIG.WS_BASE_URL}${CONFIG.MARKET_WS_PATH}`;
    return endpoint;
  }

  private bindSocket(socket: WebSocketLike): void {
    socket.on("open", () => {
      this.onOpen();
    });
    socket.on("close", () => {
      void this.onClose();
    });
    socket.on("error", (error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.onError(normalizedError);
    });
    socket.on("message", (data) => {
      this.onMessage(data);
    });
  }

  private onOpen(): void {
    this.logger.debug("[STREAM] Market WS opened");
    this.subscribedAssetIds.clear();
    this.flushSubscriptions();
  }

  private async onClose(): Promise<void> {
    this.logger.warn("[STREAM] Market WS closed");
    while (!this.isDisconnectRequested) {
      try {
        await this.openSocket();
        break;
      } catch {
        await this.clock.sleep(this.reconnectDelayMs);
      }
    }
  }

  private onError(error: Error): void {
    this.logger.error(`[STREAM] Market WS error: ${error.message}`);
  }

  private onMessage(data: unknown): void {
    const events = this.parser.parse(data);
    for (const event of events) {
      if (event.type === "price") {
        this.lastPriceByAssetId.set(event.assetId, event.price);
      }
      if (event.type === "book") {
        this.lastOrderBookByAssetId.set(event.assetId, { bids: event.bids, asks: event.asks });
      }
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }

  private flushSubscriptions(): void {
    const pendingAssetIds: string[] = [];
    for (const assetId of this.desiredAssetIds) {
      if (!this.subscribedAssetIds.has(assetId)) {
        pendingAssetIds.push(assetId);
      }
    }
    if (pendingAssetIds.length > 0) {
      const payload = { type: "market", operation: "subscribe", assets_ids: pendingAssetIds, custom_feature_enabled: true };
      const sent = this.sendPayload(payload);
      if (sent) {
        for (const assetId of pendingAssetIds) {
          this.subscribedAssetIds.add(assetId);
        }
      }
    }
  }

  private sendPayload(payload: Record<string, unknown>): boolean {
    const currentSocket = this.ws;
    const canSend = currentSocket !== null && currentSocket.readyState === currentSocket.OPEN;
    if (canSend) {
      currentSocket.send(JSON.stringify(payload));
    } else {
      this.logger.warn("[STREAM] Cannot send payload because websocket is not open");
    }
    return canSend;
  }

  private async openSocket(): Promise<void> {
    const endpoint = this.getEndpointUrl();
    try {
      if (this.ws) {
        this.ws.close();
      }
      const socket = this.webSocketFactory.create(endpoint);
      this.ws = socket;
      this.bindSocket(socket);
      await new Promise<void>((resolve) => {
        socket.on("open", () => {
          resolve();
        });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw MarketStreamConnectionError.forEndpoint(endpoint, reason);
    }
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async connect(options?: ConnectMarketStreamOptions): Promise<void> {
    this.isDisconnectRequested = false;
    this.reconnectDelayMs = options?.reconnectDelayMs ?? CONFIG.DEFAULT_RECONNECT_DELAY_MS;
    await this.openSocket();
  }

  public async disconnect(): Promise<void> {
    this.isDisconnectRequested = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public subscribe(options: SubscribeMarketAssetsOptions): void {
    for (const assetId of options.assetIds) {
      this.desiredAssetIds.add(assetId);
    }
    this.flushSubscriptions();
  }

  public unsubscribe(options: UnsubscribeMarketAssetsOptions): void {
    const removableAssetIds: string[] = [];
    for (const assetId of options.assetIds) {
      this.desiredAssetIds.delete(assetId);
      if (this.subscribedAssetIds.has(assetId)) {
        removableAssetIds.push(assetId);
      }
    }
    if (removableAssetIds.length > 0) {
      const payload = { type: "market", operation: "unsubscribe", assets_ids: removableAssetIds, custom_feature_enabled: true };
      const sent = this.sendPayload(payload);
      if (sent) {
        for (const assetId of removableAssetIds) {
          this.subscribedAssetIds.delete(assetId);
        }
      }
    }
  }

  public addListener(options: AddMarketListenerOptions): () => void {
    this.listeners.add(options.listener);
    const remove = () => {
      this.listeners.delete(options.listener);
    };
    return remove;
  }

  public getAssetPrice(options: GetAssetPriceOptions): number | null {
    const result = this.lastPriceByAssetId.get(options.assetId) ?? null;
    return result;
  }

  public getAssetOrderBook(options: GetAssetOrderBookOptions): OrderBook | null {
    const result = this.lastOrderBookByAssetId.get(options.assetId) ?? null;
    return result;
  }

  /**
   * @section static:methods
   */

  // empty
}
