import { strict as assert } from "node:assert";
import { test } from "node:test";

import CONFIG from "../src/config.ts";
import { OrderService } from "../src/orders/order-service.ts";
import { OrderClientInitializationError } from "../src/orders/order-client-initialization-error.ts";
import { OrderConfirmationFailedError } from "../src/orders/order-confirmation-failed-error.ts";
import { OrderConfirmationTimeoutError } from "../src/orders/order-confirmation-timeout-error.ts";
import { OrderPlacementError } from "../src/orders/order-placement-error.ts";
import type { ClobApiKeyCreds, ClobClientFactory, ClobClientLike } from "../src/orders/order-types.ts";
import type { Clock, WebSocketFactory, WebSocketLike } from "../src/shared/contracts.ts";
import type { PolymarketMarket } from "../src/markets/market-types.ts";

class FakeWebSocket implements WebSocketLike {
  public readonly OPEN = 1;
  public readonly CLOSED = 3;
  public readyState = 0;
  public readonly sentPayloads: string[] = [];
  private readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = { open: [], close: [], error: [], message: [] };

  public on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void {
    const eventListeners = this.listeners[event] ?? [];
    eventListeners.push(listener);
    this.listeners[event] = eventListeners;
  }

  public send(data: string): void {
    this.sentPayloads.push(data);
  }

  public close(): void {
    if (this.readyState !== this.CLOSED) {
      this.readyState = this.CLOSED;
      this.emit("close");
    }
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

type TestContext = { readonly service: OrderService; readonly sockets: FakeWebSocket[]; readonly client: ClobClientLike };

type CreateServiceContextOptions = { readonly overrides?: Partial<ClobClientLike>; readonly clock?: Clock };

function createServiceContext(options?: CreateServiceContextOptions): TestContext {
  const apiKeyCreds: ClobApiKeyCreds = { key: "k", secret: "s", passphrase: "p" };
  const sockets: FakeWebSocket[] = [];
  const baseClient: ClobClientLike = {
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
  const client: ClobClientLike = { ...baseClient, ...(options?.overrides ?? {}) };
  const clobClientFactory: ClobClientFactory = {
    async createUnauthedClient() {
      return client;
    },
    async createAuthedClient() {
      return client;
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
  const serviceOptions = options?.clock ? { clobClientFactory, webSocketFactory, clock: options.clock } : { clobClientFactory, webSocketFactory };
  const service = OrderService.create(serviceOptions);
  const context: TestContext = { service, sockets, client };
  return context;
}

test("OrderService throws typed initialization error before init", async () => {
  const service = OrderService.create();
  await assert.rejects(
    async () => {
      await service.getMyBalance();
    },
    (error: unknown) => {
      const matches = error instanceof OrderClientInitializationError;
      return matches;
    }
  );
});

test("OrderService posts taker order and confirms through user websocket", async () => {
  const context = createServiceContext();
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 2, price: 0.51, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;
  assert.equal(posted.id, "order-1");

  const confirmationPromise = context.service.waitForOrderConfirmation({ order: posted, timeoutMs: 500 });
  const socket = context.sockets[0]!;
  socket.emit("message", JSON.stringify({ event_type: "trade", status: "CONFIRMED", taker_order_id: "order-1", maker_orders: [] }));
  const confirmation = await confirmationPromise;

  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.status, "confirmed");
  await context.service.disconnect();
});

test("OrderService timeout path rechecks order and throws typed timeout error", async () => {
  let cancelOrderCalls = 0;
  const context = createServiceContext({
    overrides: {
      async cancelOrder() {
        cancelOrderCalls += 1;
        return { cancelled: ["order-timeout"] };
      },
      async createAndPostMarketOrder() {
        return { success: true, orderID: "order-timeout" };
      },
      async getTrades() {
        return [{ status: "MATCHED", taker_order_id: "order-timeout", maker_orders: [] }];
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;

  await assert.rejects(
    async () => {
      await context.service.waitForOrderConfirmation({ order: posted, timeoutMs: 10, cancelOnTimeout: true });
    },
    (error: unknown) => {
      const matches = error instanceof OrderConfirmationTimeoutError;
      return matches;
    }
  );

  assert.equal(cancelOrderCalls > 0, true);
  await context.service.disconnect();
});

test("OrderService maker sell caps size with sellable balance", async () => {
  let postedSize = 0;
  const context = createServiceContext({
    overrides: {
      async getBalanceAllowance() {
        return { balance: "1500000" };
      },
      async createAndPostOrder(order: Record<string, unknown>) {
        postedSize = Number(order.size ?? 0);
        return { success: true, orderID: "maker-sell-order" };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 2, price: 0.55, direction: "up", op: "sell", executionType: "maker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;

  assert.equal(posted.id, "maker-sell-order");
  assert.equal(posted.size, 1.5);
  assert.equal(postedSize, 1.5);
  await context.service.disconnect();
});

test("OrderService taker sell cancels opposite orders and uses sellable amount", async () => {
  const canceledInputs: Array<{ market: string; asset_id: string }> = [];
  let postedAmount = 0;
  const context = createServiceContext({
    overrides: {
      async getBalanceAllowance() {
        return { balance: "1200000" };
      },
      async cancelMarketOrders(input: { market: string; asset_id: string }) {
        canceledInputs.push(input);
        return { cancelled: ["x"] };
      },
      async createAndPostMarketOrder(order: Record<string, unknown>) {
        postedAmount = Number(order.amount ?? 0);
        return { success: true, orderID: "taker-sell-order" };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 2, price: 0.51, direction: "down", op: "sell", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;

  assert.equal(posted.id, "taker-sell-order");
  assert.equal(posted.size, 1.2);
  assert.equal(postedAmount, 1.2);
  assert.deepEqual(canceledInputs[0], { market: "condition-1", asset_id: "up-token" });
  await context.service.disconnect();
});

test("OrderService paper mode avoids posting and confirms after delay", async () => {
  const context = createServiceContext({
    overrides: {
      async createAndPostOrder() {
        throw new Error("should not call createAndPostOrder in paper mode");
      },
      async createAndPostMarketOrder() {
        throw new Error("should not call createAndPostMarketOrder in paper mode");
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", paperMode: true });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;
  const confirmation = await context.service.waitForOrderConfirmation({ order: posted });

  assert.equal(typeof posted.id, "string");
  assert.equal(confirmation.status, "confirmed");
  await context.service.disconnect();
});

test("OrderService throws typed failed confirmation error when trade status is FAILED", async () => {
  const context = createServiceContext({
    overrides: {
      async createAndPostMarketOrder() {
        return { success: true, orderID: "order-failed" };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;
  const confirmationPromise = context.service.waitForOrderConfirmation({ order: posted, timeoutMs: 500 });
  context.sockets[0]!.emit("message", JSON.stringify({ event_type: "trade", status: "FAILED", taker_order_id: "order-failed", maker_orders: [] }));

  await assert.rejects(
    async () => {
      await confirmationPromise;
    },
    (error: unknown) => {
      const matches = error instanceof OrderConfirmationFailedError;
      return matches;
    }
  );
  await context.service.disconnect();
});

test("OrderService rechecks pending order on reconnect and resolves as confirmed", async () => {
  const context = createServiceContext({
    overrides: {
      async createAndPostMarketOrder() {
        return { success: true, orderID: "order-reconnect" };
      },
      async getTrades() {
        return [{ status: "CONFIRMED", taker_order_id: "order-reconnect", maker_orders: [] }];
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedResult = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedResult, null);
  const posted = postedResult!;
  const confirmationPromise = context.service.waitForOrderConfirmation({ order: posted, timeoutMs: 500 });
  context.sockets[0]!.close();

  const confirmation = await confirmationPromise;

  assert.equal(context.sockets.length > 1, true);
  assert.equal(confirmation.status, "confirmed");
  await context.service.disconnect();
});

test("OrderService rejects unsafe taker buy amount", async () => {
  const context = createServiceContext();
  await context.service.init({ privateKey: "0xabc" });

  await assert.rejects(
    async () => {
      await context.service.postOrder({ market: createMarket(), size: 10, price: 0.9, direction: "up", op: "buy", executionType: "taker" });
    },
    (error: unknown) => {
      const matches = error instanceof OrderPlacementError;
      return matches;
    }
  );
  await context.service.disconnect();
});

test("OrderService sends PING heartbeat frames on user websocket", async () => {
  const sleepCalls: number[] = [];
  const sleepResolvers: Array<() => void> = [];
  const clock: Clock = {
    now() {
      return Date.now();
    },
    async sleep(milliseconds) {
      sleepCalls.push(milliseconds);
      await new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    }
  };
  const context = createServiceContext({ clock });
  await context.service.init({ privateKey: "0xabc" });

  assert.equal(sleepCalls[0], CONFIG.WS_HEARTBEAT_INTERVAL_MS);
  sleepResolvers[0]!();
  await new Promise<void>((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });

  const hasAuthPayload = context.sockets[0]!.sentPayloads.some((payload) => payload.includes('"type":"user"'));
  assert.equal(hasAuthPayload, true);
  assert.equal(context.sockets[0]!.sentPayloads.includes("PING"), true);

  await context.service.disconnect();
});
