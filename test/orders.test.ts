import { strict as assert } from "node:assert";
import { test } from "node:test";

import { OrderService } from "../src/orders/order-service.ts";
import { OrderConfirmationTimeoutError } from "../src/orders/order-confirmation-timeout-error.ts";
import type { ClobApiKeyCreds, ClobClientFactory, ClobClientLike } from "../src/orders/order-types.ts";
import type { WebSocketFactory, WebSocketLike } from "../src/shared/contracts.ts";
import type { PolymarketMarket } from "../src/markets/market-types.ts";

class FakeWebSocket implements WebSocketLike {
  public readonly OPEN = 1;
  public readonly CLOSED = 3;
  public readyState = 0;
  private readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = { open: [], close: [], error: [], message: [] };

  public on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void {
    const eventListeners = this.listeners[event] ?? [];
    eventListeners.push(listener);
    this.listeners[event] = eventListeners;
  }

  public send(): void {
    // empty
  }

  public close(): void {
    this.readyState = this.CLOSED;
    this.emit("close");
  }

  public emit(event: "open" | "close" | "error" | "message", ...args: unknown[]): void {
    const eventListeners = this.listeners[event] ?? [];
    for (const listener of eventListeners) {
      listener(...args);
    }
  }
}

function createMarket(): PolymarketMarket {
  const market: PolymarketMarket = {
    id: "m1",
    slug: "btc-updown-5m-123",
    question: "BTC up?",
    symbol: "btc",
    conditionId: "condition-1",
    outcomes: ["Up", "Down"],
    clobTokenIds: ["up-token", "down-token"],
    upTokenId: "up-token",
    downTokenId: "down-token",
    orderMinSize: 1,
    orderPriceMinTickSize: "0.01",
    eventStartTime: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T00:05:00.000Z",
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2026-01-01T00:05:00.000Z"),
    raw: {}
  };
  return market;
}

test("OrderService posts taker order and confirms through user websocket", async () => {
  const apiKeyCreds: ClobApiKeyCreds = { key: "k", secret: "s", passphrase: "p" };
  const sockets: FakeWebSocket[] = [];
  const authedClient: ClobClientLike = {
    async deriveApiKey() {
      return apiKeyCreds;
    },
    async getBalanceAllowance() {
      return { balance: "10000000" };
    },
    async updateBalanceAllowance() {
      // empty
    },
    async cancelOrder() {
      return { cancelled: [] };
    },
    async cancelMarketOrders() {
      return { cancelled: [] };
    },
    async createAndPostOrder() {
      return { success: true, orderID: "maker-order" };
    },
    async createAndPostMarketOrder() {
      return { success: true, orderID: "order-1" };
    },
    async getTrades() {
      return [{ status: "CONFIRMED", taker_order_id: "order-1", maker_orders: [] }];
    }
  };
  const clobClientFactory: ClobClientFactory = {
    async createUnauthedClient() {
      return authedClient;
    },
    async createAuthedClient() {
      return authedClient;
    }
  };
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = OrderService.create({ clobClientFactory, webSocketFactory });
  await service.init({ privateKey: "0xabc" });

  const postedResult = await service.postOrder({ market: createMarket(), size: 2, price: 0.51, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;
  assert.equal(posted.id, "order-1");

  const confirmationPromise = service.waitForOrderConfirmation({ order: posted, timeoutMs: 500 });
  const socket = sockets[0]!;
  socket.emit("message", JSON.stringify({ event_type: "trade", status: "CONFIRMED", taker_order_id: "order-1", maker_orders: [] }));
  const confirmation = await confirmationPromise;

  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.status, "confirmed");
});

test("OrderService timeout path rechecks order and throws typed timeout error", async () => {
  const apiKeyCreds: ClobApiKeyCreds = { key: "k", secret: "s", passphrase: "p" };
  let cancelOrderCalls = 0;
  const authedClient: ClobClientLike = {
    async deriveApiKey() {
      return apiKeyCreds;
    },
    async getBalanceAllowance() {
      return { balance: "10000000" };
    },
    async updateBalanceAllowance() {
      // empty
    },
    async cancelOrder() {
      cancelOrderCalls += 1;
      return { cancelled: ["order-timeout"] };
    },
    async cancelMarketOrders() {
      return { cancelled: [] };
    },
    async createAndPostOrder() {
      return { success: true, orderID: "maker-order" };
    },
    async createAndPostMarketOrder() {
      return { success: true, orderID: "order-timeout" };
    },
    async getTrades() {
      return [{ status: "MATCHED", taker_order_id: "order-timeout", maker_orders: [] }];
    }
  };
  const clobClientFactory: ClobClientFactory = {
    async createUnauthedClient() {
      return authedClient;
    },
    async createAuthedClient() {
      return authedClient;
    }
  };
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      const socket = new FakeWebSocket();
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = OrderService.create({ clobClientFactory, webSocketFactory });
  await service.init({ privateKey: "0xabc" });

  const postedResult = await service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;

  await assert.rejects(
    async () => {
      await service.waitForOrderConfirmation({ order: posted, timeoutMs: 10, cancelOnTimeout: true });
    },
    (error: unknown) => {
      const matches = error instanceof OrderConfirmationTimeoutError;
      return matches;
    }
  );

  assert.equal(cancelOrderCalls > 0, true);
});
