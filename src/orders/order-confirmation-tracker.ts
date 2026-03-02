/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { decodeWsMessage, isRecord } from "../shared/utils.ts";
import type { Logger } from "../shared/contracts.ts";
import type { OrderMessage, OrderServiceReconnectListener, OrderStatus, UserStreamMessage } from "./order-types.ts";

/**
 * @section consts
 */

const PENDING_TRADE_STATUSES = ["MATCHED", "MINED", "RETRYING"] as const;

/**
 * @section types
 */

// empty

export class OrderConfirmationTracker {
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

  private readonly logger: Logger;
  private readonly listeners: Set<(message: OrderMessage) => void>;
  private readonly reconnectListeners: Set<OrderServiceReconnectListener>;
  private readonly orderIdsInProcess: Set<string>;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(logger: Logger) {
    this.logger = logger;
    this.listeners = new Set<(message: OrderMessage) => void>();
    this.reconnectListeners = new Set<OrderServiceReconnectListener>();
    this.orderIdsInProcess = new Set<string>();
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(logger: Logger): OrderConfirmationTracker {
    const tracker = new OrderConfirmationTracker(logger);
    return tracker;
  }

  /**
   * @section private:methods
   */

  private isPendingTradeStatus(status: string): boolean {
    const result = PENDING_TRADE_STATUSES.includes(status as (typeof PENDING_TRADE_STATUSES)[number]);
    return result;
  }

  private parseStatusForTrade(message: UserStreamMessage): OrderStatus | null {
    const status = String(message.status ?? "");
    let result: OrderStatus | null = null;
    if (status === "CONFIRMED") {
      result = "confirmed";
    }
    if (status === "FAILED") {
      result = "failed";
    }
    if (this.isPendingTradeStatus(status)) {
      result = null;
    }
    return result;
  }

  private parseStatusForOrder(message: UserStreamMessage): OrderStatus | null {
    const type = String(message.type ?? "");
    const status = type === "CANCELLATION" ? "cancelled" : null;
    return status;
  }

  private resolveOrderId(message: UserStreamMessage): string | null {
    const eventType = String(message.event_type ?? "");
    let orderId: string | null = null;
    if (eventType === "trade") {
      const candidateIds: string[] = [];
      if (typeof message.taker_order_id === "string") {
        candidateIds.push(message.taker_order_id);
      }
      const makerOrders = message.maker_orders ?? [];
      for (const makerOrder of makerOrders) {
        candidateIds.push(makerOrder.order_id);
      }
      const foundId = candidateIds.find((candidateId) => {
        return this.orderIdsInProcess.has(candidateId);
      });
      orderId = foundId ?? null;
    }
    if (eventType === "order") {
      orderId = typeof message.id === "string" ? message.id : null;
    }
    return orderId;
  }

  private notify(message: OrderMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public markOrderInProcess(orderId: string): void {
    this.orderIdsInProcess.add(orderId);
  }

  public unmarkOrderInProcess(orderId: string): void {
    this.orderIdsInProcess.delete(orderId);
  }

  public addOrderListener(listener: (message: OrderMessage) => void): () => void {
    this.listeners.add(listener);
    const remove = () => {
      this.listeners.delete(listener);
    };
    return remove;
  }

  public addReconnectListener(listener: OrderServiceReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    const remove = () => {
      this.reconnectListeners.delete(listener);
    };
    return remove;
  }

  public async emitReconnect(): Promise<void> {
    for (const listener of this.reconnectListeners) {
      try {
        await listener();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[ORDERS] Reconnect listener failed: ${reason}`);
      }
    }
  }

  public processUserStreamMessage(rawMessage: unknown): void {
    const text = decodeWsMessage(rawMessage);
    let message: UserStreamMessage | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed)) {
        message = parsed as UserStreamMessage;
      }
    } catch {
      message = null;
    }
    if (message) {
      const orderId = this.resolveOrderId(message);
      if (orderId) {
        const eventType = String(message.event_type ?? "");
        let status: OrderStatus | null = null;
        if (eventType === "trade") {
          status = this.parseStatusForTrade(message);
        }
        if (eventType === "order") {
          status = this.parseStatusForOrder(message);
        }
        if (status) {
          this.notify({ id: orderId, status });
        }
      }
    } else {
      this.logger.debug(`[ORDERS] Ignoring non-JSON user stream message: ${text}`);
    }
  }

  /**
   * @section static:methods
   */

  // empty
}
