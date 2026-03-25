/**
 * @section imports:internals
 */

import config from "../config.ts";
import { DefaultRuntimeService } from "../shared/default-runtime.service.ts";
import type { Clock, Logger, WebSocketFactory, WebSocketLike } from "../shared/shared-contract.types.ts";
import type { OrderBook } from "../market/market.types.ts";
import { MarketStreamParserService } from "./market-stream-parser.service.ts";
import type {
  AddMarketListenerOptions,
  ConnectMarketStreamOptions,
  GetAssetOrderBookOptions,
  GetAssetPriceOptions,
  MarketEvent,
  SubscribeMarketAssetsOptions,
  UnsubscribeMarketAssetsOptions
} from "./stream.types.ts";

/**
 * @section consts
 */

const DEFAULT_SUBSCRIPTION_TYPE = "market";
const STABLE_CONNECTION_THRESHOLD_MS = 30_000;
const MAX_RECONNECT_DELAY_MULTIPLIER = 8;

/**
 * @section types
 */

type MarketStreamServiceOptions = {
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly webSocketFactory?: WebSocketFactory;
  readonly parser?: MarketStreamParserService;
};

export class MarketStreamService {
  /**
   * @section private:attributes
   */

  private reconnectDelayMs: number;
  private reconnectAttemptCount: number;
  private isDisconnectRequested: boolean;
  private isHeartbeatActive: boolean;

  /**
   * @section private:properties
   */

  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly parser: MarketStreamParserService;
  private readonly listeners: Set<(event: MarketEvent) => void>;
  private readonly desiredAssetIds: Set<string>;
  private readonly subscribedAssetIds: Set<string>;
  private readonly lastPriceByAssetId: Map<string, number>;
  private readonly lastOrderBookByAssetId: Map<string, OrderBook>;
  private ws: WebSocketLike | null;
  private connectedAtMs: number | null;

  /**
   * @section constructor
   */

  public constructor(options?: MarketStreamServiceOptions) {
    const defaultRuntimeService = DefaultRuntimeService.create();
    this.clock = options?.clock ?? defaultRuntimeService.createClock();
    this.logger = options?.logger ?? defaultRuntimeService.createLogger();
    this.webSocketFactory = options?.webSocketFactory ?? defaultRuntimeService.createWebSocketFactory();
    this.parser = options?.parser ?? MarketStreamParserService.create();
    this.listeners = new Set<(event: MarketEvent) => void>();
    this.desiredAssetIds = new Set<string>();
    this.subscribedAssetIds = new Set<string>();
    this.lastPriceByAssetId = new Map<string, number>();
    this.lastOrderBookByAssetId = new Map<string, OrderBook>();
    this.ws = null;
    this.reconnectDelayMs = config.DEFAULT_RECONNECT_DELAY_MS;
    this.reconnectAttemptCount = 0;
    this.isDisconnectRequested = false;
    this.isHeartbeatActive = false;
    this.connectedAtMs = null;
  }

  /**
   * @section factory
   */

  public static createDefault(options?: MarketStreamServiceOptions): MarketStreamService {
    const service = new MarketStreamService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private getEndpointUrl(): string {
    const endpointUrl = `${config.WS_BASE_URL}${config.MARKET_WS_PATH}`;
    return endpointUrl;
  }

  private bindSocket(socket: WebSocketLike): void {
    socket.on("open", () => {
      this.onOpen(socket);
    });
    socket.on("close", () => {
      void this.onClose(socket);
    });
    socket.on("error", (error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.onError(socket, normalizedError);
    });
    socket.on("message", (payload) => {
      this.onMessage(socket, payload);
    });
  }

  private onOpen(socket: WebSocketLike): void {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.logger.debug("[STREAM] Market websocket opened.");
      this.connectedAtMs = this.clock.now();
      this.subscribedAssetIds.clear();
      this.startHeartbeatLoop();
      this.flushSubscriptions();
    }
  }

  private async onClose(socket: WebSocketLike): Promise<void> {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.logger.warn("[STREAM] Market websocket closed.");
      this.ws = null;
      this.updateReconnectAttemptCount();
      this.connectedAtMs = null;
      this.stopHeartbeatLoop();
      while (!this.isDisconnectRequested) {
        const reconnectDelayMs = this.getReconnectDelayMs();
        await this.clock.sleep(reconnectDelayMs);
        try {
          await this.openSocket();
          break;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`[STREAM] Reconnect attempt failed: ${reason}`);
        }
      }
    }
  }

  private onError(socket: WebSocketLike, error: Error): void {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.logger.error(`[STREAM] Market websocket error: ${error.message}`);
    }
  }

  private onMessage(socket: WebSocketLike, payload: unknown): void {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      const events = this.parser.parse(payload);
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
  }

  private createSubscriptionPayload(operation: "subscribe" | "unsubscribe", assetIds: string[]): string {
    const payload = JSON.stringify({ type: DEFAULT_SUBSCRIPTION_TYPE, operation, assets_ids: assetIds, custom_feature_enabled: true });
    return payload;
  }

  private sendPayload(payload: string): boolean {
    const currentSocket = this.ws;
    const canSend = currentSocket !== null && currentSocket.readyState === currentSocket.OPEN;
    if (canSend) {
      currentSocket.send(payload);
    }
    if (!canSend) {
      this.logger.warn("[STREAM] Cannot send websocket payload because the socket is not open.");
    }
    return canSend;
  }

  private flushSubscriptions(): void {
    const pendingAssetIds = [...this.desiredAssetIds].filter((assetId) => !this.subscribedAssetIds.has(assetId));
    if (pendingAssetIds.length > 0) {
      const sent = this.sendPayload(this.createSubscriptionPayload("subscribe", pendingAssetIds));
      if (sent) {
        for (const assetId of pendingAssetIds) {
          this.subscribedAssetIds.add(assetId);
        }
      }
    }
  }

  private async openSocket(): Promise<void> {
    const endpointUrl = this.getEndpointUrl();
    try {
      const hasOpenSocket = this.ws !== null && this.ws.readyState === this.ws.OPEN;
      if (!hasOpenSocket) {
        const socket = this.webSocketFactory.create(endpointUrl);
        this.ws = socket;
        this.bindSocket(socket);
        await new Promise<void>((resolve) => {
          socket.on("open", () => {
            resolve();
          });
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect market websocket '${endpointUrl}': ${reason}`);
    }
  }

  private startHeartbeatLoop(): void {
    if (!this.isHeartbeatActive) {
      this.isHeartbeatActive = true;
      void this.runHeartbeatLoop();
    }
  }

  private stopHeartbeatLoop(): void {
    this.isHeartbeatActive = false;
  }

  private async runHeartbeatLoop(): Promise<void> {
    while (this.isHeartbeatActive && !this.isDisconnectRequested) {
      await this.clock.sleep(config.WS_HEARTBEAT_INTERVAL_MS);
      if (this.isHeartbeatActive && !this.isDisconnectRequested) {
        this.sendPing();
      }
    }
  }

  private sendPing(): boolean {
    const sent = this.sendPayload("PING");
    return sent;
  }

  private updateReconnectAttemptCount(): void {
    const connectedAtMs = this.connectedAtMs;
    const isStableConnection = connectedAtMs !== null && this.clock.now() - connectedAtMs >= STABLE_CONNECTION_THRESHOLD_MS;
    if (isStableConnection) {
      this.reconnectAttemptCount = 0;
    }
    if (!isStableConnection) {
      this.reconnectAttemptCount += 1;
    }
  }

  private getReconnectDelayMs(): number {
    const hasImmediateReconnect = this.reconnectAttemptCount <= 1;
    const exponent = Math.max(0, this.reconnectAttemptCount - 2);
    const cappedExponent = Math.min(exponent, MAX_RECONNECT_DELAY_MULTIPLIER);
    const jitterFactor = this.getReconnectJitterFactor();
    const backoffDelayMs = this.reconnectDelayMs * 2 ** cappedExponent;
    const reconnectDelayMs = hasImmediateReconnect ? 0 : Math.round(backoffDelayMs * jitterFactor);
    return reconnectDelayMs;
  }

  private getReconnectJitterFactor(): number {
    const minFactor = config.DEFAULT_RECONNECT_JITTER_MIN_FACTOR;
    const maxFactor = config.DEFAULT_RECONNECT_JITTER_MAX_FACTOR;
    const jitterFactor = minFactor + Math.random() * (maxFactor - minFactor);
    return jitterFactor;
  }

  /**
   * @section public:methods
   */

  public async connect(options?: ConnectMarketStreamOptions): Promise<void> {
    this.isDisconnectRequested = false;
    this.reconnectDelayMs = options?.reconnectDelayMs ?? config.DEFAULT_RECONNECT_DELAY_MS;
    this.reconnectAttemptCount = 0;
    await this.openSocket();
  }

  public async disconnect(): Promise<void> {
    this.isDisconnectRequested = true;
    this.stopHeartbeatLoop();
    this.connectedAtMs = null;
    if (this.ws !== null) {
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
      const sent = this.sendPayload(this.createSubscriptionPayload("unsubscribe", removableAssetIds));
      if (sent) {
        for (const assetId of removableAssetIds) {
          this.subscribedAssetIds.delete(assetId);
        }
      }
    }
  }

  public addListener(options: AddMarketListenerOptions): () => void {
    this.listeners.add(options.listener);
    const removeListener = (): void => { this.listeners.delete(options.listener); };
    return removeListener;
  }

  public getAssetPrice(options: GetAssetPriceOptions): number | null {
    const assetPrice = this.lastPriceByAssetId.get(options.assetId) ?? null;
    return assetPrice;
  }

  public getAssetOrderBook(options: GetAssetOrderBookOptions): OrderBook | null {
    const orderBook = this.lastOrderBookByAssetId.get(options.assetId) ?? null;
    return orderBook;
  }
}
