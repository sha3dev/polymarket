/**
 * @section imports:externals
 */

import { AssetType, OrderType, Side } from "@polymarket/clob-client";
import type { SignatureType } from "@polymarket/order-utils";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import { createDefaultClock, createDefaultLogger, createDefaultWebSocketFactory } from "../shared/defaults.ts";
import type { Clock, WebSocketFactory, WebSocketLike } from "../shared/contracts.ts";
import { clamp, round } from "../shared/utils.ts";
import { OrderClientInitializationError } from "./order-client-initialization-error.ts";
import { OrderConfirmationFailedError } from "./order-confirmation-failed-error.ts";
import { OrderConfirmationTimeoutError } from "./order-confirmation-timeout-error.ts";
import { OrderPlacementError } from "./order-placement-error.ts";
import { OrderConfirmationTracker } from "./order-confirmation-tracker.ts";
import { PolymarketClobClientFactory } from "./clob-client-factory.ts";
import type {
  ClobApiKeyCreds,
  ClobClientFactory,
  ClobClientLike,
  ExecutionType,
  InitializeOrderServiceOptions,
  OrderMessage,
  OrderStatus,
  PostOrderOptions,
  PostedOrder,
  PostedOrderWithStatus,
  TradeInfo,
  WaitForOrderConfirmationOptions
} from "./order-types.ts";

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
  readonly webSocketFactory?: WebSocketFactory;
  readonly clobClientFactory?: ClobClientFactory;
  readonly tracker?: OrderConfirmationTracker;
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
   * @section protected:attributes
   */

  // empty

  /**
   * @section private:properties
   */

  private readonly logger: ReturnType<typeof createDefaultLogger>;
  private readonly clock: Clock;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly clobClientFactory: ClobClientFactory;
  private readonly tracker: OrderConfirmationTracker;
  private clobClient: ClobClientLike | null;
  private apiKeyCreds: ClobApiKeyCreds | null;
  private ws: WebSocketLike | null;
  private initOptions: InitializeOrderServiceOptions | null;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options?: OrderServiceOptions) {
    this.logger = createDefaultLogger();
    this.clock = options?.clock ?? createDefaultClock();
    this.webSocketFactory = options?.webSocketFactory ?? createDefaultWebSocketFactory();
    this.clobClientFactory = options?.clobClientFactory ?? PolymarketClobClientFactory.create();
    this.tracker = options?.tracker ?? OrderConfirmationTracker.create();
    this.clobClient = null;
    this.apiKeyCreds = null;
    this.ws = null;
    this.reconnectDelayMs = CONFIG.DEFAULT_RECONNECT_DELAY_MS;
    this.maxAllowedSlippage = CONFIG.DEFAULT_MAX_ALLOWED_SLIPPAGE;
    this.isDisconnectRequested = false;
    this.isHeartbeatActive = false;
    this.initOptions = null;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(options?: OrderServiceOptions): OrderService {
    const service = new OrderService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private ensureInitialized(): void {
    if (!this.clobClient || !this.apiKeyCreds || !this.initOptions) {
      throw OrderClientInitializationError.missingInitialization();
    }
  }

  private getUserStreamEndpoint(): string {
    const endpoint = `${CONFIG.WS_BASE_URL}${CONFIG.USER_WS_PATH}`;
    return endpoint;
  }

  private bindSocket(socket: WebSocketLike): void {
    socket.on("open", () => {
      void this.onOpen();
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

  private async onOpen(): Promise<void> {
    this.ensureInitialized();
    const payload = { type: "user", auth: { apiKey: this.apiKeyCreds!.key, secret: this.apiKeyCreds!.secret, passphrase: this.apiKeyCreds!.passphrase } };
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
    this.startHeartbeatLoop();
    await this.tracker.emitReconnect();
  }

  private async onClose(): Promise<void> {
    this.logger.warn("[ORDERS] User websocket closed");
    this.stopHeartbeatLoop();
    while (!this.isDisconnectRequested) {
      try {
        await this.connectUserStream();
        break;
      } catch {
        await this.clock.sleep(this.reconnectDelayMs);
      }
    }
  }

  private onError(error: Error): void {
    this.logger.error(`[ORDERS] User websocket error: ${error.message}`);
  }

  private onMessage(data: unknown): void {
    this.tracker.processUserStreamMessage(data);
  }

  private async connectUserStream(): Promise<void> {
    const endpoint = this.getUserStreamEndpoint();
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
      await this.clock.sleep(CONFIG.WS_HEARTBEAT_INTERVAL_MS);
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
    } else {
      this.logger.warn("[ORDERS] Cannot send PING because websocket is not open");
    }
    return canSend;
  }

  private getOrderContext(options: PostOrderOptions): OrderContext {
    const tokenId = options.direction === "up" ? options.market.upTokenId : options.market.downTokenId;
    const tickSize = String(options.market.orderPriceMinTickSize ?? CONFIG.DEFAULT_ORDER_TICK_SIZE);
    const expiration = Math.floor((this.clock.now() + CONFIG.DEFAULT_ORDER_EXPIRATION_MS) / 1000);
    const context: OrderContext = { tokenId, tickSize, expiration };
    return context;
  }

  private getTickSizeValue(tickSize: string): number {
    const parsed = Number(tickSize);
    const fallback = Number(CONFIG.DEFAULT_ORDER_TICK_SIZE);
    const result = Number.isFinite(parsed) && parsed > 0 && parsed < CONFIG.MAX_PRICE ? parsed : fallback;
    return result;
  }

  private normalizeOrderPrice(price: number, tickSize: string): number {
    const tickSizeValue = this.getTickSizeValue(tickSize);
    const minimum = tickSizeValue;
    const maximum = Math.max(minimum, CONFIG.MAX_PRICE - tickSizeValue);
    const rounded = round(price, CONFIG.ORDER_PRICE_DECIMALS);
    const clamped = clamp(rounded, minimum, maximum);
    const result = round(clamped, CONFIG.ORDER_PRICE_DECIMALS);
    return result;
  }

  private async getSellableSize(tokenId: string): Promise<number> {
    this.ensureInitialized();
    const allowanceInput = { asset_type: AssetType.CONDITIONAL, token_id: tokenId };
    try {
      await this.clobClient!.updateBalanceAllowance(allowanceInput);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[ORDERS] Failed to refresh sellable size token=${tokenId}: ${reason}`);
    }
    const balanceAllowance = await this.clobClient!.getBalanceAllowance(allowanceInput);
    const microBalance = Number(balanceAllowance.balance ?? 0);
    const shares = microBalance / 1_000_000;
    const floored = Math.floor(shares * 100) / 100;
    const result = Math.max(0, floored);
    return result;
  }

  private async cancelOrderSafe(orderId: string): Promise<void> {
    this.ensureInitialized();
    try {
      await this.clobClient!.cancelOrder({ orderID: orderId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[ORDERS] Failed to cancel order ${orderId}: ${reason}`);
    }
  }

  private getOrderSide(op: "buy" | "sell"): Side {
    const side = op === "buy" ? Side.BUY : Side.SELL;
    return side;
  }

  private buildPostedOrder(options: PostOrderOptions, orderId: string, price: number, size: number): PostedOrder {
    const postedOrder: PostedOrder = { ...options, id: orderId, date: new Date(), price, size };
    return postedOrder;
  }

  private async postPaperOrder(options: PostOrderOptions): Promise<PostedOrder> {
    await this.clock.sleep(CONFIG.DEFAULT_PAPER_MODE_DELAY_MS);
    const postedOrder = this.buildPostedOrder(options, String(this.clock.now()), options.price, options.size);
    return postedOrder;
  }

  private validateSafeBuyAmount(amount: number): void {
    if (amount > CONFIG.SAFE_MAX_BUY_AMOUNT) {
      throw OrderPlacementError.unsafeAmount(amount);
    }
  }

  private async cancelOppositeOrdersBeforeSell(options: PostOrderOptions): Promise<void> {
    this.ensureInitialized();
    const oppositeTokenId = options.direction === "up" ? options.market.downTokenId : options.market.upTokenId;
    await this.clobClient!.cancelMarketOrders({ market: options.market.conditionId, asset_id: oppositeTokenId });
  }

  private async postMakerOrder(options: PostOrderOptions, context: OrderContext): Promise<PostedOrder | null> {
    this.ensureInitialized();
    let adjustedSize = round(options.size, CONFIG.ORDER_SIZE_DECIMALS);
    if (options.op === "sell") {
      const sellableSize = await this.getSellableSize(context.tokenId);
      adjustedSize = round(Math.min(adjustedSize, sellableSize), CONFIG.ORDER_SIZE_DECIMALS);
    }
    const adjustedPrice = this.normalizeOrderPrice(options.price, context.tickSize);
    let postedOrder: PostedOrder | null = null;
    if (adjustedSize > 0 && adjustedPrice > 0) {
      const response = await this.clobClient!.createAndPostOrder(
        { tokenID: context.tokenId, price: adjustedPrice, size: adjustedSize, side: this.getOrderSide(options.op), expiration: context.expiration },
        { tickSize: context.tickSize },
        OrderType.GTD
      );
      if (response.success && response.orderID) {
        this.tracker.markOrderInProcess(response.orderID);
        postedOrder = this.buildPostedOrder(options, response.orderID, adjustedPrice, adjustedSize);
      }
    }
    return postedOrder;
  }

  private async postTakerOrder(options: PostOrderOptions, context: OrderContext): Promise<PostedOrder | null> {
    this.ensureInitialized();
    let adjustedPrice = 0;
    let amount = 0;
    let postedSize = options.size;
    if (options.op === "buy") {
      adjustedPrice = this.normalizeOrderPrice(options.price + this.maxAllowedSlippage, context.tickSize);
      amount = round(options.size * adjustedPrice, CONFIG.ORDER_AMOUNT_DECIMALS);
      this.validateSafeBuyAmount(amount);
      postedSize = options.size;
    }
    if (options.op === "sell") {
      const sellableSize = await this.getSellableSize(context.tokenId);
      amount = round(Math.min(options.size, sellableSize), CONFIG.ORDER_SIZE_DECIMALS);
      adjustedPrice = this.normalizeOrderPrice(options.price - this.maxAllowedSlippage, context.tickSize);
      await this.cancelOppositeOrdersBeforeSell(options);
      postedSize = amount;
    }
    let postedOrder: PostedOrder | null = null;
    if (amount > 0 && adjustedPrice > 0) {
      const response = await this.clobClient!.createAndPostMarketOrder(
        { tokenID: context.tokenId, side: this.getOrderSide(options.op), price: adjustedPrice, amount },
        { tickSize: context.tickSize },
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
    const result = ["MATCHED", "MINED", "RETRYING"].includes(status);
    return result;
  }

  private findTradeForOrder(trades: TradeInfo[], orderId: string): TradeInfo | null {
    const foundTrade = trades.find((trade) => {
      const makerHasOrder = trade.maker_orders?.some((makerOrder) => {
        return makerOrder.order_id === orderId;
      });
      const matched = trade.taker_order_id === orderId || Boolean(makerHasOrder);
      return matched;
    });
    const result = foundTrade ?? null;
    return result;
  }

  private async recheckOrderStatus(order: PostedOrder, cancelOnTimeout: boolean): Promise<OrderStatus> {
    this.ensureInitialized();
    const trades = await this.clobClient!.getTrades();
    const trade = this.findTradeForOrder(trades, order.id);
    let status: OrderStatus = "failed";
    if (trade) {
      if (trade.status === "CONFIRMED") {
        status = "confirmed";
      }
      if (trade.status === "FAILED") {
        status = "failed";
      }
      if (this.isPendingTradeStatus(trade.status)) {
        status = "failed";
      }
    }
    if (!trade) {
      status = "failed";
    }
    if (status === "failed" && cancelOnTimeout && !order.paperMode) {
      await this.cancelOrderSafe(order.id);
    }
    return status;
  }

  /**
   * @section protected:methods
   */

  // empty

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
    this.maxAllowedSlippage = options.maxAllowedSlippage ?? CONFIG.DEFAULT_MAX_ALLOWED_SLIPPAGE;
    this.initOptions = options;
    this.isDisconnectRequested = false;
    await this.connectUserStream();
  }

  public async disconnect(): Promise<void> {
    this.isDisconnectRequested = true;
    this.stopHeartbeatLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public async getMyBalance(): Promise<number> {
    this.ensureInitialized();
    const response = await this.clobClient!.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const balance = round(Number(response.balance ?? 0) / 1_000_000, 2);
    return balance;
  }

  public async postOrder(options: PostOrderOptions): Promise<PostedOrder | null> {
    this.ensureInitialized();
    let postedOrder: PostedOrder | null = null;
    if (options.paperMode) {
      postedOrder = await this.postPaperOrder(options);
    }
    if (!options.paperMode) {
      const context = this.getOrderContext(options);
      const executionType: ExecutionType = options.executionType ?? "taker";
      if (executionType === "maker") {
        postedOrder = await this.postMakerOrder(options, context);
      }
      if (executionType === "taker") {
        postedOrder = await this.postTakerOrder(options, context);
      }
    }
    if (!postedOrder) {
      throw OrderPlacementError.postFailed(`market=${options.market.slug} op=${options.op} direction=${options.direction}`);
    }
    return postedOrder;
  }

  public async waitForOrderConfirmation(options: WaitForOrderConfirmationOptions): Promise<PostedOrderWithStatus> {
    this.ensureInitialized();
    const timeoutMs = options.timeoutMs ?? CONFIG.DEFAULT_ORDER_CONFIRMATION_TIMEOUT_MS;
    const cancelOnTimeout = options.cancelOnTimeout ?? true;
    const startedAt = this.clock.now();
    const { order } = options;
    const result = await new Promise<PostedOrderWithStatus>((resolve) => {
      let resolved = false;
      let timeoutId: NodeJS.Timeout | null = null;
      const finish = (status: OrderStatus, error?: Error) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          removeOrderListener();
          removeReconnectListener();
          this.tracker.unmarkOrderInProcess(order.id);
          const latency = this.clock.now() - startedAt;
          const finalResultBase = { ...order, ok: !error, status, latency };
          const finalResult: PostedOrderWithStatus = error ? { ...finalResultBase, error } : { ...finalResultBase };
          resolve(finalResult);
        }
      };
      const onReconnect = async () => {
        const status = await this.recheckOrderStatus(order, cancelOnTimeout);
        let error: Error | undefined;
        if (status !== "confirmed") {
          error = OrderConfirmationFailedError.forOrder(order.id, "recheck failed after reconnect");
        }
        finish(status, error);
      };
      const onOrderMessage = (message: OrderMessage) => {
        if (message.id === order.id) {
          let error: Error | undefined;
          if (message.status !== "confirmed") {
            error = OrderConfirmationFailedError.forOrder(order.id, `status=${message.status}`);
          }
          finish(message.status, error);
        }
      };
      const removeReconnectListener = this.tracker.addReconnectListener(onReconnect);
      const removeOrderListener = this.tracker.addOrderListener(onOrderMessage);
      if (order.paperMode) {
        timeoutId = setTimeout(() => {
          finish("confirmed");
        }, CONFIG.DEFAULT_PAPER_MODE_DELAY_MS);
      }
      if (!order.paperMode) {
        timeoutId = setTimeout(async () => {
          const status = await this.recheckOrderStatus(order, cancelOnTimeout);
          let error: Error | undefined;
          if (status !== "confirmed") {
            error = OrderConfirmationTimeoutError.forOrder(order.id, timeoutMs);
          }
          finish(status, error);
        }, timeoutMs);
      }
    });
    if (!result.ok && result.error) {
      throw result.error;
    }
    return result;
  }

  /**
   * @section static:methods
   */

  // empty
}
