/**
 * Module Overview
 * File: src/lib/user.ts
 * Purpose: Gestiona autenticacion CLOB y ciclo completo de ordenes.
 * Role: Publica ordenes maker/taker y confirma estados por websocket.
 */
/**
 * imports: externals
 */

import WebSocket, { type RawData } from "ws";
import { ClobClient, AssetType, Side, OrderType, type ApiKeyCreds, type TickSize, type UserMarketOrder, type UserOrder } from "@polymarket/clob-client";
import type { SignatureType } from "@polymarket/order-utils";
import { Wallet } from "@ethersproject/wallet";

/**
 * imports: internal
 */

import { logger, config } from "../init";
import utils, { type Direction, type Operation, type ExecutionType } from "./utils";
import type { Market } from "./market/market.type";

/**
 * types
 */

type OrderStatus = "confirmed" | "cancelled" | "failed";

type NewOrder = { market: Market; size: number; price: number; op: Operation; direction: Direction; paperMode?: boolean; executionType?: ExecutionType };

type OrderMessage = { id: string; status: OrderStatus };

export type PostedOrder = NewOrder & { date: Date; id: string };

type PostedOrderStatus = { ok: boolean; status: OrderStatus; error?: Error; latency: number };

type PostedOrderWithStatus = PostedOrder & PostedOrderStatus;

type WaitForOrderConfirmationOptions = { timeoutMs?: number; cancelOnTimeout?: boolean };

type OrderContext = { tokenId: string; tickSize: TickSize; expiration: number };

type PostOrderResponse = { success?: boolean; orderID?: string; status?: string; errorMsg?: string; error?: unknown };

type MakerOrderDraft = { order: UserOrder; size: number; price: number };

type TakerOrderDraft = { order: UserMarketOrder; size: number; price: number };

/**
 * consts
 */

const SAFE_MAX_BUY_AMOUNT = 5;
const PAPER_MODE_DELAY_MS = 3_000;
const DEFAULT_SIGNATURE_TYPE: SignatureType = 1;
const DEFAULT_TICK_SIZE = "0.01";
const ORDER_PRICE_DECIMALS = 4;
const ORDER_SIZE_DECIMALS = 2;
const ORDER_AMOUNT_DECIMALS = 4;
const CLOB_BASE_URL = "https://clob.polymarket.com";
const CLOB_CHAIN_ID = 137;
const WSS_BASE_URL = "wss://ws-subscriptions-clob.polymarket.com/ws";
const WSS_MARKET_CHANNEL_URL = `${WSS_BASE_URL}/user`;
const WSS_RECONNECT_DELAY_MS = 2_000;
const WAIT_FOR_CONFIRMATION_TIMEOUT = 60_000;
const DEFAULT_ORDER_EXPIRATION_MS = (60 + 15) * 1_000;
const MAX_PRICE = 1;

/**
 * class
 */

export default abstract class {
  /**
   * private: attributes
   */

  private static listeners: Set<(message: OrderMessage) => void> = new Set();
  private static reconnectListeners: Set<() => Promise<void>> = new Set();
  private static ws: WebSocket;
  private static clobClient: ClobClient | null = null;
  private static apiKeyCreds: ApiKeyCreds | null = null;
  private static orderIdsInProcess = new Set<string>();

  /**
   * private: methods
   */

  private static checkClobClient() {
    if (!this.clobClient) {
      throw new Error("Clob client not initialized");
    }
  }

  private static isPendingTradeStatus(status: string) {
    return ["MATCHED", "MINED", "RETRYING"].includes(status);
  }

  private static onOpen() {
    if (this.apiKeyCreds) {
      logger.debug(`[USER] User WS opened`);
      const auth = { apiKey: this.apiKeyCreds.key, secret: this.apiKeyCreds.secret, passphrase: this.apiKeyCreds!.passphrase };
      const payload = { type: "user", auth };
      this.ws.send(JSON.stringify(payload));
      for (const listener of this.reconnectListeners) {
        void listener().catch(error => {
          logger.debug(`[USER] Reconnect listener failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } else {
      throw new Error(`apiKeyCreds not initialized`);
    }
  }

  private static async onClose() {
    logger.debug(`[USER] User WS closed. Reconnecting...`);
    while (this.ws.readyState === WebSocket.CLOSED) {
      await this.connect();
      await utils.sleep(WSS_RECONNECT_DELAY_MS);
    }
  }

  private static onError(error: Error) {
    logger.error(`[USER] User WS error: ${error.message}`);
  }

  private static onMessage(message: RawData) {
    const text = utils.decodeWsMessageEvent(message);
    if (utils.isValidJson(text)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const message = JSON.parse(text) as any;
        let id: string | undefined = undefined;
        const { type, status: orderStatus, event_type: eventType } = message;
        let status: OrderStatus | null = null;
        if (eventType === "trade") {
          const orderIds: string[] = [];
          orderIds.push(message.taker_order_id);
          orderIds.push(...(message.maker_orders?.map((i: { order_id: string }) => i.order_id) ?? []));
          id = orderIds.find(i => this.orderIdsInProcess.has(i));
          if (id) {
            if (orderStatus === "CONFIRMED") {
              status = "confirmed";
            }
            if (orderStatus === "FAILED") {
              status = "failed";
            }
            if (this.isPendingTradeStatus(orderStatus)) {
              // Nothing
            }
          }
        } else if (eventType === "order") {
          id = message.id;
          if (type === "CANCELLATION") {
            status = "cancelled";
          }
        }
        if (id) {
          logger.debug(`[USER] Order ${id}: ${eventType}/${type}/${orderStatus}`);
          if (status) {
            this.listeners.forEach(listener => listener({ id, status }));
          }
        }
      } catch (err) {
        logger.error(`[USER] Failed to parse User WS message as JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      logger.debug(`[USER] Unexpected message: ${text}`);
    }
  }

  private static async connect() {
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

  private static async getSellableSize(tokenId: string) {
    this.checkClobClient();
    const balanceParams = { asset_type: AssetType.CONDITIONAL, token_id: tokenId };
    try {
      await this.clobClient!.updateBalanceAllowance(balanceParams);
    } catch (e) {
      logger.debug(`[USER] Error getting sellable size: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ba = await this.clobClient!.getBalanceAllowance(balanceParams);
    const microBalance = Number(ba.balance ?? 0);
    const shares = microBalance / 1_000_000;
    const floored = Math.floor(shares * 100) / 100;
    return Math.max(0, floored);
  }

  private static async cancelOrderSafe(orderId: string) {
    this.checkClobClient();
    try {
      const response = await this.clobClient!.cancelOrder({ orderID: orderId });
      const isCancelled = response.cancelled?.includes(orderId);
      if (isCancelled) {
        logger.debug(`[USER] Order ${orderId} cancelled on timeout`);
      }
    } catch (e) {
      logger.debug(`[USER] Error cancelling order ${orderId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private static getOrderContext(options: NewOrder): OrderContext {
    const tickSize = (options.market.orderPriceMinTickSize || DEFAULT_TICK_SIZE).toString() as TickSize;
    const expiration = Math.floor((Date.now() + DEFAULT_ORDER_EXPIRATION_MS) / 1000);
    const tokenId = options.direction === "up" ? options.market.upTokenId : options.market.downTokenId;
    return { tokenId, tickSize, expiration };
  }

  private static getTickSizeValue(tickSize: TickSize) {
    const parsed = Number(tickSize);
    const fallback = Number(DEFAULT_TICK_SIZE);
    return utils.isNumber(parsed) && parsed > 0 && parsed < MAX_PRICE ? parsed : fallback;
  }

  private static normalizeOrderPrice(price: number, tickSize: TickSize) {
    const tickSizeValue = this.getTickSizeValue(tickSize);
    const minPrice = tickSizeValue;
    const maxPrice = Math.max(minPrice, MAX_PRICE - tickSizeValue);
    const rounded = utils.round(price, ORDER_PRICE_DECIMALS);
    const clamped = utils.clamp(rounded, minPrice, maxPrice);
    return utils.round(clamped, ORDER_PRICE_DECIMALS);
  }

  private static getOrderSide(op: Operation): Side {
    return op === "buy" ? Side.BUY : Side.SELL;
  }

  private static buildPostedOrder(options: NewOrder, id: string, overrides?: Partial<Pick<PostedOrder, "size" | "price">>): PostedOrder {
    return { id, date: new Date(), ...options, ...overrides };
  }

  private static handlePostOrderResponse(
    response: PostOrderResponse,
    executionLabel: ExecutionType,
    options: NewOrder,
    overrides?: Partial<Pick<PostedOrder, "size" | "price">>,
  ): PostedOrder | null {
    if (response?.success && response.orderID) {
      logger.debug(`[USER] ${executionLabel.toUpperCase()} order posted successfully: ${response.orderID}`);
      this.orderIdsInProcess.add(response.orderID);
      return this.buildPostedOrder(options, response.orderID, overrides);
    }
    logger.warn(`[USER] ${executionLabel.toUpperCase()} order status: ${response?.status} - ${response?.errorMsg || response?.error}`);
    return null;
  }

  private static async postPaperOrder(options: NewOrder): Promise<PostedOrder> {
    await utils.sleep(PAPER_MODE_DELAY_MS);
    return this.buildPostedOrder(options, Date.now().toString());
  }

  private static async buildMakerOrderDraft(options: NewOrder, context: OrderContext): Promise<MakerOrderDraft | null> {
    const { size, price, op } = options;
    const side = this.getOrderSide(op);
    let adjustedSize = utils.round(size, ORDER_SIZE_DECIMALS);
    if (op === "sell") {
      const currentSellableSize = await this.getSellableSize(context.tokenId);
      adjustedSize = utils.round(Math.min(adjustedSize, currentSellableSize), ORDER_SIZE_DECIMALS);
    }
    const adjustedPrice = this.normalizeOrderPrice(price, context.tickSize);
    if (adjustedSize <= 0 || adjustedPrice <= 0) {
      return null;
    }
    const order: UserOrder = {
      tokenID: context.tokenId,
      price: adjustedPrice,
      size: adjustedSize,
      side,
      expiration: context.expiration,
    };
    return { order, size: adjustedSize, price: adjustedPrice };
  }

  private static async postMakerOrder(options: NewOrder, context: OrderContext): Promise<PostedOrder | null> {
    const draft = await this.buildMakerOrderDraft(options, context);
    if (!draft) {
      return null;
    }
    const response = (await this.clobClient!.createAndPostOrder<OrderType.GTD>(draft.order, { tickSize: context.tickSize }, OrderType.GTD)) as PostOrderResponse;
    return this.handlePostOrderResponse(response, "maker", options, { size: draft.size, price: draft.price });
  }

  private static getOppositeTokenId(market: Market, direction: Direction) {
    return direction === "up" ? market.downTokenId : market.upTokenId;
  }

  private static async cancelOppositeOrdersBeforeSell(options: NewOrder) {
    const oppositeTokenId = this.getOppositeTokenId(options.market, options.direction);
    const cancelResponse = await this.clobClient?.cancelMarketOrders({ market: options.market.conditionId, asset_id: oppositeTokenId });
    logger.debug(
      `[USER] cancelled ${cancelResponse?.cancelled?.length ?? 0} orders before selling. SELL ${options.market.symbol}`,
    );
  }

  private static getBuyMarketAmount(size: number, price: number) {
    return utils.round(size * price, ORDER_AMOUNT_DECIMALS);
  }

  private static assertSafeBuyAmount(amount: number) {
    if (amount > SAFE_MAX_BUY_AMOUNT) {
      throw new Error(`[USER] We are paying a non-sense amount: ${amount}`);
    }
  }

  private static async buildTakerSellOrderDraft(options: NewOrder, context: OrderContext): Promise<TakerOrderDraft | null> {
    const { size, price } = options;
    const currentSellableSize = await this.getSellableSize(context.tokenId);
    const takerSellSize = utils.round(Math.min(size, currentSellableSize), ORDER_SIZE_DECIMALS);
    const takerSellPrice = this.normalizeOrderPrice(price - config.MAX_ALLOWED_SLIPPAGE, context.tickSize);
    if (takerSellSize <= 0 || takerSellPrice <= 0) {
      return null;
    }
    await this.cancelOppositeOrdersBeforeSell(options);
    const order: UserMarketOrder = {
      tokenID: context.tokenId,
      side: Side.SELL,
      price: takerSellPrice,
      amount: takerSellSize,
    };
    return { order, size: takerSellSize, price: takerSellPrice };
  }

  private static buildTakerBuyOrderDraft(options: NewOrder, context: OrderContext): TakerOrderDraft | null {
    const takerBuyPrice = this.normalizeOrderPrice(options.price + config.MAX_ALLOWED_SLIPPAGE, context.tickSize);
    if (takerBuyPrice <= 0) {
      return null;
    }
    const buyAmount = this.getBuyMarketAmount(options.size, takerBuyPrice);
    if (buyAmount <= 0) {
      return null;
    }
    this.assertSafeBuyAmount(buyAmount);
    const order: UserMarketOrder = {
      tokenID: context.tokenId,
      side: Side.BUY,
      price: takerBuyPrice,
      amount: buyAmount,
    };
    return { order, size: options.size, price: takerBuyPrice };
  }

  private static async buildTakerOrderDraft(options: NewOrder, context: OrderContext): Promise<TakerOrderDraft | null> {
    if (options.op === "sell") {
      return this.buildTakerSellOrderDraft(options, context);
    }
    return this.buildTakerBuyOrderDraft(options, context);
  }

  private static async postTakerOrder(options: NewOrder, context: OrderContext): Promise<PostedOrder | null> {
    const draft = await this.buildTakerOrderDraft(options, context);
    if (!draft) {
      return null;
    }
    const response = (await this.clobClient!.createAndPostMarketOrder<OrderType.FOK>(draft.order, { tickSize: context.tickSize }, OrderType.FOK)) as PostOrderResponse;
    return this.handlePostOrderResponse(response, "taker", options, { size: draft.size, price: draft.price });
  }

  /**
   * public properties
   */

  public static get ApiKeyCreds() {
    if (this.apiKeyCreds) {
      return this.apiKeyCreds!;
    }
    throw new Error(`apiKeyCreds not initialized`);
  }

  /**
   * public: methods
   */

  public static async init() {
    if (!this.clobClient) {
      const { POLYMARKET_PRIVATE_KEY: privateKey, POLYMARKET_FUNDER_ADDRESS: funder } = config;
      const signer = new Wallet(privateKey);
      logger.debug(`[USER] initializing clob client for signer ${signer.address}`);
      const clobClient = new ClobClient(CLOB_BASE_URL, CLOB_CHAIN_ID, signer);
      this.apiKeyCreds = await clobClient.deriveApiKey();
      this.clobClient = new ClobClient(CLOB_BASE_URL, CLOB_CHAIN_ID, signer, this.apiKeyCreds, DEFAULT_SIGNATURE_TYPE, funder);
      await this.connect();
      return this.clobClient;
    }
    throw new Error("[USER] Clob client already initialized");
  }

  public static async getMyBalance() {
    this.checkClobClient();
    logger.debug("[USER] Getting my balance");
    const result = await this.clobClient!.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return utils.round(Number(result.balance) / 1_000_000);
  }

  public static async waitForOrderConfirmation(order: PostedOrder, options?: WaitForOrderConfirmationOptions): Promise<PostedOrderWithStatus> {
    const t0 = Date.now();
    const { paperMode } = order;
    const waitTimeoutMs = options?.timeoutMs ?? WAIT_FOR_CONFIRMATION_TIMEOUT;
    this.checkClobClient();
    if (!this.ws) {
      throw new Error(`[USER] User websocket not initialized!`);
    }
    const { id: orderId } = order;
    if (!paperMode) {
      logger.debug(`[USER] Waiting for order ...`);
    }
    return new Promise<PostedOrderWithStatus>(resolve => {
      let resolved = false;
      let timeout: NodeJS.Timeout | null = null;
      const finish = (status: OrderStatus, error?: Error) => {
        if (!resolved) {
          resolved = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          this.reconnectListeners.delete(recheckListener);
          this.listeners.delete(listener);
          this.orderIdsInProcess.delete(orderId);
          const latency = Date.now() - t0;
          const result = { ...order, ok: !error, error, status, latency };
          if (!paperMode) {
            logger.debug(`[USER] Order ${order.op} ${order.market.symbol} ${order.direction.toUpperCase()} (${order.size} @ ${order.price}) ${status} in ${latency}ms`);
          }
          resolve(result);
        }
      };
      const recheckListener = async () => {
        try {
          logger.debug(`[USER] Checking missing order updates after reconnection/timeout (${orderId})`);
          const trades = await this.clobClient!.getTrades();
          const trade = trades?.find(i => i.taker_order_id === orderId || i.maker_orders?.find(j => j.order_id === orderId));
          if (trade) {
            let status: OrderStatus | null = null;
            if (trade.status === "CONFIRMED") {
              status = "confirmed";
              return finish("confirmed");
            }
            if (trade.status === "FAILED") {
              status = "failed";
              return finish("failed", new Error(`[USER] Order not confirmed (after recheck): ${status}`));
            }
            if (this.isPendingTradeStatus(trade.status)) {
              logger.debug(`[USER] timeout-pending status=${trade.status} orderId=${orderId}`);
              if (!paperMode) {
                await this.cancelOrderSafe(orderId);
              }
              return finish("failed", new Error(`[USER] Order timeout with pending status: ${trade.status}`));
            }
            if (!status) {
              if (!paperMode) {
                await this.cancelOrderSafe(orderId);
              }
              return finish("failed", new Error(`[USER] Order timeout without final status: ${trade.status}`));
            }
          } else {
            logger.debug(`[USER] timeout-not-found orderId=${orderId}`);
            if (!paperMode) {
              await this.cancelOrderSafe(orderId);
            }
            return finish("failed", new Error(`[USER] Recheck on WS reconnect but trade not found`));
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          return finish("failed", new Error(`[USER] Error rechecking order status: ${errMsg}`));
        }
      };
      const listener = (msg: OrderMessage) => {
        const { id, status } = msg;
        if (id === orderId) {
          if (["cancelled", "failed"].includes(status)) {
            return finish(status, new Error(`[USER] Order not confirmed: ${status}`));
          }
          return finish("confirmed");
        }
      };
      if (paperMode) {
        // logger.debug(`[USER] Simulating order confirmation in paper mode: ${orderId}`);
        setTimeout(() => finish("confirmed"), PAPER_MODE_DELAY_MS);
      } else {
        timeout = setTimeout(recheckListener, waitTimeoutMs);
        this.reconnectListeners.add(recheckListener);
        this.listeners.add(listener);
      }
    });
  }

  public static async postOrder(options: NewOrder): Promise<PostedOrder | null> {
    this.checkClobClient();
    const { paperMode } = options;
    const executionType = options.executionType ?? "taker";
    if (paperMode) {
      return this.postPaperOrder(options);
    }
    const context = this.getOrderContext(options);
    if (executionType === "maker") {
      return this.postMakerOrder(options, context);
    }
    return this.postTakerOrder(options, context);
  }
}
