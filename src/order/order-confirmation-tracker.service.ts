/**
 * @section imports:internals
 */

import type { OrderMessage, OrderServiceReconnectListener, OrderStatus, UserStreamMessage } from "./order.types.ts";

export class OrderConfirmationTrackerService {
  /**
   * @section private:properties
   */

  private readonly orderIdsInProcess: Set<string>;
  private readonly orderListeners: Set<(message: OrderMessage) => void>;
  private readonly reconnectListeners: Set<OrderServiceReconnectListener>;

  /**
   * @section constructor
   */

  public constructor() {
    this.orderIdsInProcess = new Set<string>();
    this.orderListeners = new Set<(message: OrderMessage) => void>();
    this.reconnectListeners = new Set<OrderServiceReconnectListener>();
  }

  /**
   * @section factory
   */

  public static create(): OrderConfirmationTrackerService {
    const service = new OrderConfirmationTrackerService();
    return service;
  }

  /**
   * @section private:methods
   */

  private parseMessage(payload: unknown): UserStreamMessage | null {
    let parsedMessage: unknown = null;
    try {
      parsedMessage = typeof payload === "string" ? (JSON.parse(payload) as unknown) : payload;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    const normalizedMessage = parsedMessage && typeof parsedMessage === "object" && !Array.isArray(parsedMessage) ? (parsedMessage as UserStreamMessage) : null;
    return normalizedMessage;
  }

  private isPendingStatus(status: string): boolean {
    const isPending = status === "MATCHED" || status === "MINED" || status === "RETRYING";
    return isPending;
  }

  private findTrackedOrderId(message: UserStreamMessage): string | null {
    const makerOrderId = message.maker_orders?.find((makerOrder) => this.orderIdsInProcess.has(makerOrder.order_id))?.order_id ?? null;
    const trackedOrderId = this.orderIdsInProcess.has(message.taker_order_id ?? "") ? message.taker_order_id ?? null : makerOrderId;
    return trackedOrderId;
  }

  private emitOrderStatus(id: string, status: OrderStatus): void {
    const orderMessage: OrderMessage = { id, status };
    for (const orderListener of this.orderListeners) {
      orderListener(orderMessage);
    }
  }

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
    this.orderListeners.add(listener);
    const removeListener = (): void => { this.orderListeners.delete(listener); };
    return removeListener;
  }

  public addReconnectListener(listener: OrderServiceReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    const removeListener = (): void => { this.reconnectListeners.delete(listener); };
    return removeListener;
  }

  public processUserStreamMessage(payload: unknown): void {
    const message = this.parseMessage(payload);
    if (message && message.event_type === "trade" && typeof message.status === "string") {
      const trackedOrderId = this.findTrackedOrderId(message);
      const isFinalStatus = !this.isPendingStatus(message.status);
      if (trackedOrderId && isFinalStatus) {
        const status: OrderStatus = message.status === "CONFIRMED" ? "confirmed" : "failed";
        this.emitOrderStatus(trackedOrderId, status);
      }
    }
    if (message && message.event_type === "order" && message.type === "CANCELLATION" && typeof message.id === "string") {
      this.emitOrderStatus(message.id, "cancelled");
    }
  }

  public async emitReconnect(): Promise<void> {
    for (const reconnectListener of this.reconnectListeners) {
      try {
        await reconnectListener();
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
