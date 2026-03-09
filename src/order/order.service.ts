/**
 * @section imports:externals
 */

import { AssetType, OrderType, Side } from "@polymarket/clob-client";
import type { SignatureType } from "@polymarket/order-utils";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { DefaultRuntimeService } from "../shared/default-runtime.service.ts";
import { NumberNormalizerService } from "../shared/number-normalizer.service.ts";
import type { Clock, Logger, WebSocketFactory, WebSocketLike } from "../shared/shared-contract.types.ts";
import type { PolymarketMarket } from "../market/market.types.ts";
import { ClobClientFactoryService } from "./clob-client-factory.service.ts";
import { OrderConfirmationTrackerService } from "./order-confirmation-tracker.service.ts";
import type {
  ClobApiKeyCreds,
  ClobClientFactory,
  ClobClientLike,
  ExecutionType,
  InitializeOrderServiceOptions,
  OrderStatus,
  PostOrderOptions,
  PostedOrder,
  PostedOrderWithStatus,
  TradeInfo,
  WaitForOrderConfirmationOptions
} from "./order.types.ts";

/**
 * @section consts
 */

const DEFAULT_SIGNATURE_TYPE: SignatureType = 1;

/**
 * @section types
 */

type OrderContext = { tokenId: string; tickSize: string; expiration: number };

type OrderServiceOptions = {
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly webSocketFactory?: WebSocketFactory;
  readonly clobClientFactory?: ClobClientFactory;
  readonly tracker?: OrderConfirmationTrackerService;
  readonly numberNormalizer?: NumberNormalizerService;
};

export class OrderService {
  /**
   * @section private:attributes
   */

  private reconnectDelayMs: number;
  private maxAllowedSlippage: number;
  private isDisconnectRequested: boolean;
  private isHeartbeatActive: boolean;

  /**
   * @section private:properties
   */

  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly clobClientFactory: ClobClientFactory;
  private readonly tracker: OrderConfirmationTrackerService;
  private readonly numberNormalizer: NumberNormalizerService;
  private clobClient: ClobClientLike | null;
  private apiKeyCreds: ClobApiKeyCreds | null;
  private ws: WebSocketLike | null;
  private initOptions: InitializeOrderServiceOptions | null;

  /**
   * @section constructor
   */

  public constructor(options?: OrderServiceOptions) {
    const defaultRuntimeService = DefaultRuntimeService.create();
    this.clock = options?.clock ?? defaultRuntimeService.createClock();
    this.logger = options?.logger ?? defaultRuntimeService.createLogger();
    this.webSocketFactory = options?.webSocketFactory ?? defaultRuntimeService.createWebSocketFactory();
    this.clobClientFactory = options?.clobClientFactory ?? ClobClientFactoryService.create();
    this.tracker = options?.tracker ?? OrderConfirmationTrackerService.create();
    this.numberNormalizer = options?.numberNormalizer ?? NumberNormalizerService.create();
    this.clobClient = null;
    this.apiKeyCreds = null;
    this.ws = null;
    this.initOptions = null;
    this.reconnectDelayMs = config.DEFAULT_RECONNECT_DELAY_MS;
    this.maxAllowedSlippage = config.DEFAULT_MAX_ALLOWED_SLIPPAGE;
    this.isDisconnectRequested = false;
    this.isHeartbeatActive = false;
  }

  /**
   * @section factory
   */

  public static createDefault(options?: OrderServiceOptions): OrderService {
    const service = new OrderService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private ensureInitialized(): void {
    if (!this.clobClient || !this.apiKeyCreds || !this.initOptions) {
      throw new Error("Order service is not initialized. Call init() with trading credentials before using this method.");
    }
  }

  private getUserStreamEndpoint(): string {
    const endpoint = `${config.WS_BASE_URL}${config.USER_WS_PATH}`;
    return endpoint;
  }

  private bindSocket(socket: WebSocketLike): void {
    socket.on("open", () => {
      void this.onOpen(socket);
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

  private async onOpen(socket: WebSocketLike): Promise<void> {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.ensureInitialized();
      const payload = JSON.stringify({ type: "user", auth: { apiKey: this.apiKeyCreds!.key, secret: this.apiKeyCreds!.secret, passphrase: this.apiKeyCreds!.passphrase } });
      if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
        this.ws.send(payload);
      }
      this.startHeartbeatLoop();
      await this.tracker.emitReconnect();
    }
  }

  private async onClose(socket: WebSocketLike): Promise<void> {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.logger.warn("[ORDER] User websocket closed.");
      this.ws = null;
      this.stopHeartbeatLoop();
      while (!this.isDisconnectRequested) {
        try {
          await this.connectUserStream();
          break;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`[ORDER] User websocket reconnect failed: ${reason}`);
          await this.clock.sleep(this.reconnectDelayMs);
        }
      }
    }
  }

  private onError(socket: WebSocketLike, error: Error): void {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.logger.error(`[ORDER] User websocket error: ${error.message}`);
    }
  }

  private onMessage(socket: WebSocketLike, payload: unknown): void {
    const isCurrentSocket = this.ws === socket;
    if (isCurrentSocket) {
      this.tracker.processUserStreamMessage(payload);
    }
  }

  private async connectUserStream(): Promise<void> {
    const endpoint = this.getUserStreamEndpoint();
    try {
      const hasOpenSocket = this.ws !== null && this.ws.readyState === this.ws.OPEN;
      if (!hasOpenSocket) {
        const socket = this.webSocketFactory.create(endpoint);
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
      throw new Error(`Failed to connect user websocket '${endpoint}': ${reason}`);
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
        this.sendHeartbeatPing();
      }
    }
  }

  private sendHeartbeatPing(): boolean {
    const currentSocket = this.ws;
    const canSend = currentSocket !== null && currentSocket.readyState === currentSocket.OPEN;
    if (canSend) {
      currentSocket.send("PING");
    }
    if (!canSend) {
      this.logger.warn("[ORDER] Cannot send PING because the user websocket is not open.");
    }
    return canSend;
  }

  private getOrderContext(options: PostOrderOptions): OrderContext {
    const tokenId = options.direction === "up" ? options.market.upTokenId : options.market.downTokenId;
    const tickSize = String(options.market.orderPriceMinTickSize ?? config.DEFAULT_ORDER_TICK_SIZE);
    const expiration = Math.floor((this.clock.now() + config.DEFAULT_ORDER_EXPIRATION_MS) / 1000);
    const orderContext: OrderContext = { tokenId, tickSize, expiration };
    return orderContext;
  }

  private getTickSizeValue(tickSize: string): number {
    const parsedValue = Number(tickSize);
    const fallbackValue = Number(config.DEFAULT_ORDER_TICK_SIZE);
    const tickSizeValue = Number.isFinite(parsedValue) && parsedValue > 0 && parsedValue < config.MAX_PRICE ? parsedValue : fallbackValue;
    return tickSizeValue;
  }

  private normalizeOrderPrice(price: number, tickSize: string): number {
    const tickSizeValue = this.getTickSizeValue(tickSize);
    const minimumPrice = tickSizeValue;
    const maximumPrice = Math.max(minimumPrice, config.MAX_PRICE - tickSizeValue);
    const roundedPrice = this.numberNormalizer.round(price, config.ORDER_PRICE_DECIMALS);
    const clampedPrice = this.numberNormalizer.clamp(roundedPrice, minimumPrice, maximumPrice);
    const normalizedPrice = this.numberNormalizer.round(clampedPrice, config.ORDER_PRICE_DECIMALS);
    return normalizedPrice;
  }

  private async getSellableSize(tokenId: string): Promise<number> {
    this.ensureInitialized();
    const balanceInput = { asset_type: AssetType.CONDITIONAL, token_id: tokenId };
    try {
      await this.clobClient!.updateBalanceAllowance(balanceInput);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[ORDER] Failed to refresh sellable size for token ${tokenId}: ${reason}`);
    }
    const balanceAllowance = await this.clobClient!.getBalanceAllowance(balanceInput);
    const microBalance = Number(balanceAllowance.balance ?? 0);
    const sellableSize = Math.max(0, Math.floor((microBalance / 1_000_000) * 100) / 100);
    return sellableSize;
  }

  private async cancelOrderSafe(orderId: string): Promise<void> {
    this.ensureInitialized();
    try {
      await this.clobClient!.cancelOrder({ orderID: orderId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[ORDER] Failed to cancel order ${orderId}: ${reason}`);
    }
  }

  private getOrderSide(operation: "buy" | "sell"): Side {
    const orderSide = operation === "buy" ? Side.BUY : Side.SELL;
    return orderSide;
  }

  private buildPostedOrder(options: PostOrderOptions, orderId: string, price: number, size: number): PostedOrder {
    const postedOrder: PostedOrder = { ...options, id: orderId, date: new Date(), price, size };
    return postedOrder;
  }

  private async postPaperOrder(options: PostOrderOptions): Promise<PostedOrder> {
    await this.clock.sleep(config.DEFAULT_PAPER_MODE_DELAY_MS);
    const postedOrder = this.buildPostedOrder(options, String(this.clock.now()), options.price, options.size);
    return postedOrder;
  }

  private validateSafeBuyAmount(amount: number): void {
    if (amount > config.SAFE_MAX_BUY_AMOUNT) {
      throw new Error(`Refusing taker buy because amount ${amount} exceeds safe limit ${config.SAFE_MAX_BUY_AMOUNT}.`);
    }
  }

  private async cancelOppositeOrdersBeforeSell(market: PolymarketMarket, direction: "up" | "down"): Promise<void> {
    this.ensureInitialized();
    const oppositeTokenId = direction === "up" ? market.downTokenId : market.upTokenId;
    await this.clobClient!.cancelMarketOrders({ market: market.conditionId, asset_id: oppositeTokenId });
  }

  private async postMakerOrder(options: PostOrderOptions, orderContext: OrderContext): Promise<PostedOrder | null> {
    this.ensureInitialized();
    let adjustedSize = this.numberNormalizer.round(options.size, config.ORDER_SIZE_DECIMALS);
    if (options.op === "sell") {
      const sellableSize = await this.getSellableSize(orderContext.tokenId);
      adjustedSize = this.numberNormalizer.round(Math.min(adjustedSize, sellableSize), config.ORDER_SIZE_DECIMALS);
    }
    const adjustedPrice = this.normalizeOrderPrice(options.price, orderContext.tickSize);
    let postedOrder: PostedOrder | null = null;
    if (adjustedSize > 0 && adjustedPrice > 0) {
      const response = await this.clobClient!.createAndPostOrder(
        { tokenID: orderContext.tokenId, price: adjustedPrice, size: adjustedSize, side: this.getOrderSide(options.op), expiration: orderContext.expiration },
        { tickSize: orderContext.tickSize },
        OrderType.GTD
      );
      if (response.success && response.orderID) {
        this.tracker.markOrderInProcess(response.orderID);
        postedOrder = this.buildPostedOrder(options, response.orderID, adjustedPrice, adjustedSize);
      }
    }
    return postedOrder;
  }

  private async postTakerOrder(options: PostOrderOptions, orderContext: OrderContext): Promise<PostedOrder | null> {
    this.ensureInitialized();
    let adjustedPrice = 0;
    let amount = 0;
    let postedSize = options.size;
    if (options.op === "buy") {
      adjustedPrice = this.normalizeOrderPrice(options.price + this.maxAllowedSlippage, orderContext.tickSize);
      amount = this.numberNormalizer.round(options.size * adjustedPrice, config.ORDER_AMOUNT_DECIMALS);
      this.validateSafeBuyAmount(amount);
    }
    if (options.op === "sell") {
      const sellableSize = await this.getSellableSize(orderContext.tokenId);
      amount = this.numberNormalizer.round(Math.min(options.size, sellableSize), config.ORDER_SIZE_DECIMALS);
      adjustedPrice = this.normalizeOrderPrice(options.price - this.maxAllowedSlippage, orderContext.tickSize);
      await this.cancelOppositeOrdersBeforeSell(options.market, options.direction);
      postedSize = amount;
    }
    let postedOrder: PostedOrder | null = null;
    if (amount > 0 && adjustedPrice > 0) {
      const response = await this.clobClient!.createAndPostMarketOrder(
        { tokenID: orderContext.tokenId, side: this.getOrderSide(options.op), price: adjustedPrice, amount },
        { tickSize: orderContext.tickSize },
        OrderType.FOK
      );
      if (response.success && response.orderID) {
        this.tracker.markOrderInProcess(response.orderID);
        postedOrder = this.buildPostedOrder(options, response.orderID, adjustedPrice, postedSize);
      }
    }
    return postedOrder;
  }

  private isPendingTradeStatus(status: string): boolean {
    const isPending = status === "MATCHED" || status === "MINED" || status === "RETRYING";
    return isPending;
  }

  private findTradeForOrder(trades: TradeInfo[], orderId: string): TradeInfo | null {
    const trade = trades.find((tradeInfo) => tradeInfo.taker_order_id === orderId || Boolean(tradeInfo.maker_orders?.some((makerOrder) => makerOrder.order_id === orderId))) ?? null;
    return trade;
  }

  private async recheckOrderStatus(order: PostedOrder, shouldCancelOnTimeout: boolean): Promise<OrderStatus> {
    this.ensureInitialized();
    const trades = await this.clobClient!.getTrades();
    const trade = this.findTradeForOrder(trades, order.id);
    let orderStatus: OrderStatus = "failed";
    if (trade) {
      if (trade.status === "CONFIRMED") {
        orderStatus = "confirmed";
      }
      if (trade.status === "FAILED") {
        orderStatus = "failed";
      }
      if (this.isPendingTradeStatus(trade.status)) {
        orderStatus = "failed";
      }
    }
    if (orderStatus === "failed" && shouldCancelOnTimeout && !order.paperMode) {
      await this.cancelOrderSafe(order.id);
    }
    return orderStatus;
  }

  /**
   * @section public:methods
   */

  public async init(options: InitializeOrderServiceOptions): Promise<void> {
    const signatureType = options.signatureType ?? DEFAULT_SIGNATURE_TYPE;
    const createOptions: { privateKey: string; signatureType: SignatureType; funderAddress?: string } = { privateKey: options.privateKey, signatureType };
    if (options.funderAddress) {
      createOptions.funderAddress = options.funderAddress;
    }
    const unauthedClient = await this.clobClientFactory.createUnauthedClient(createOptions);
    const apiKeyCreds = await unauthedClient.deriveApiKey();
    const authedClient = await this.clobClientFactory.createAuthedClient({ ...createOptions, apiKeyCreds });
    this.clobClient = authedClient;
    this.apiKeyCreds = apiKeyCreds;
    this.maxAllowedSlippage = options.maxAllowedSlippage ?? config.DEFAULT_MAX_ALLOWED_SLIPPAGE;
    this.initOptions = options;
    this.isDisconnectRequested = false;
    await this.connectUserStream();
  }

  public async disconnect(): Promise<void> {
    this.isDisconnectRequested = true;
    this.stopHeartbeatLoop();
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
  }

  public async getMyBalance(): Promise<number> {
    this.ensureInitialized();
    const balanceResponse = await this.clobClient!.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const balance = this.numberNormalizer.round(Number(balanceResponse.balance ?? 0) / 1_000_000, 2);
    return balance;
  }

  public async postOrder(options: PostOrderOptions): Promise<PostedOrder | null> {
    this.ensureInitialized();
    let postedOrder: PostedOrder | null = null;
    if (options.paperMode) {
      postedOrder = await this.postPaperOrder(options);
    }
    if (!options.paperMode) {
      const orderContext = this.getOrderContext(options);
      const executionType: ExecutionType = options.executionType ?? "taker";
      if (executionType === "maker") {
        postedOrder = await this.postMakerOrder(options, orderContext);
      }
      if (executionType === "taker") {
        postedOrder = await this.postTakerOrder(options, orderContext);
      }
    }
    if (!postedOrder) {
      throw new Error(`Failed to post order for market=${options.market.slug} op=${options.op} direction=${options.direction}.`);
    }
    return postedOrder;
  }

  public async waitForOrderConfirmation(options: WaitForOrderConfirmationOptions): Promise<PostedOrderWithStatus> {
    this.ensureInitialized();
    const timeoutMs = options.timeoutMs ?? config.DEFAULT_ORDER_CONFIRMATION_TIMEOUT_MS;
    const shouldCancelOnTimeout = options.shouldCancelOnTimeout ?? true;
    const startedAt = this.clock.now();
    const result = await new Promise<PostedOrderWithStatus>((resolve) => {
      let isResolved = false;
      let timeoutId: NodeJS.Timeout | null = null;
      const finish = (status: OrderStatus, error?: Error): void => {
        if (!isResolved) {
          isResolved = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          removeOrderListener();
          removeReconnectListener();
          this.tracker.unmarkOrderInProcess(options.order.id);
          const latency = this.clock.now() - startedAt;
          const baseResult = { ...options.order, ok: error === undefined, status, latency };
          const finalResult: PostedOrderWithStatus = error ? { ...baseResult, error } : baseResult;
          resolve(finalResult);
        }
      };
      const removeOrderListener = this.tracker.addOrderListener((message) => {
        if (message.id === options.order.id) {
          const error = message.status === "failed" ? new Error(`Order ${options.order.id} failed during confirmation.`) : undefined;
          finish(message.status, error);
        }
      });
      const removeReconnectListener = this.tracker.addReconnectListener(async () => {
        const status = await this.recheckOrderStatus(options.order, shouldCancelOnTimeout);
        const error = status === "confirmed" ? undefined : new Error(`Order ${options.order.id} did not confirm after reconnect recheck.`);
        finish(status, error);
      });
      timeoutId = setTimeout(() => {
        void (async () => {
          const status = options.order.paperMode ? "confirmed" : await this.recheckOrderStatus(options.order, shouldCancelOnTimeout);
          const error = status === "confirmed" ? undefined : new Error(`Order ${options.order.id} timed out after ${timeoutMs}ms.`);
          finish(status, error);
        })();
      }, timeoutMs);
    });
    return result;
  }
}
