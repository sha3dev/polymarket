import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import type { PolymarketMarket } from "../src/market/market.types.ts";
import { ClobClientFactoryService } from "../src/order/clob-client-factory.service.ts";
import { OrderService } from "../src/order/order.service.ts";
import type { ClobApiKeyCreds, ClobClientFactory, ClobClientLike } from "../src/order/order.types.ts";
import type { Clock, WebSocketFactory, WebSocketLike } from "../src/shared/shared-contract.types.ts";

const VALID_PRIVATE_KEY = "0x0123456789012345678901234567890123456789012345678901234567890123";

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

  public send(messageText: string): void {
    this.sentPayloads.push(messageText);
  }

  public close(): void {
    if (this.readyState !== this.CLOSED) {
      this.readyState = this.CLOSED;
      this.emit("close");
    }
  }

  public emit(event: "open" | "close" | "error" | "message", ...args: unknown[]): void {
    const eventListeners = this.listeners[event] ?? [];
    for (const eventListener of eventListeners) {
      eventListener(...args);
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

type TestContextOptions = { readonly overrides?: Partial<ClobClientLike>; readonly clock?: Clock };

function createTestContext(options?: TestContextOptions): TestContext {
  const apiKeyCreds: ClobApiKeyCreds = { key: "k", secret: "s", passphrase: "p" };
  const sockets: FakeWebSocket[] = [];
  const baseClient: ClobClientLike = {
    async deriveApiKey(): Promise<ClobApiKeyCreds> {
      return apiKeyCreds;
    },
    async getBalanceAllowance(): Promise<{ balance?: string }> {
      return { balance: "10000000" };
    },
    async updateBalanceAllowance(): Promise<void> {},
    async getOpenOrders(): Promise<Array<{ id: string; status: string; owner: string; maker_address: string; market: string; asset_id: string; side: string; original_size: string; size_matched: string; price: string; associate_trades: string[]; outcome: string; created_at: number; expiration: string; order_type: string }>> {
      return [];
    },
    async cancelOrder(): Promise<{ cancelled?: string[] }> {
      return { cancelled: [] };
    },
    async cancelMarketOrders(): Promise<{ cancelled?: string[] }> {
      return { cancelled: [] };
    },
    async createAndPostOrder(): Promise<{ success?: boolean; orderID?: string }> {
      return { success: true, orderID: "maker-order" };
    },
    async createAndPostMarketOrder(): Promise<{ success?: boolean; orderID?: string }> {
      return { success: true, orderID: "order-1" };
    },
    async getTrades(): Promise<Array<{ status: string; taker_order_id?: string; maker_orders?: { order_id: string }[] }>> {
      return [{ status: "CONFIRMED", taker_order_id: "order-1", maker_orders: [] }];
    }
  };
  const client: ClobClientLike = { ...baseClient, ...(options?.overrides ?? {}) };
  const clobClientFactory: ClobClientFactory = {
    async createUnauthedClient(): Promise<ClobClientLike> {
      return client;
    },
    async createAuthedClient(): Promise<ClobClientLike> {
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
  const service = OrderService.createDefault(serviceOptions);
  const context: TestContext = { service, sockets, client };
  return context;
}

test("OrderService requires init before balance calls", async () => {
  const service = OrderService.createDefault();

  await assert.rejects(async () => service.getMyBalance(), /Call init\(\)/);
});

test("ClobClientFactoryService builds CLOB clients from a real signer", async () => {
  const service = ClobClientFactoryService.create();
  const client = await service.createUnauthedClient({ privateKey: VALID_PRIVATE_KEY });

  assert.equal(typeof client.deriveApiKey, "function");
});

test("OrderService posts taker order and confirms through user websocket", async () => {
  const context = createTestContext();
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 2, price: 0.51, direction: "up", op: "buy", executionType: "taker" });
  assert.notEqual(postedOrder, null);

  const confirmationPromise = context.service.waitForOrderConfirmation({ order: postedOrder! });
  context.sockets[0]!.emit("message", JSON.stringify({ event_type: "trade", status: "CONFIRMED", taker_order_id: postedOrder!.id, maker_orders: [] }));
  const confirmation = await confirmationPromise;

  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.status, "confirmed");
  await context.service.disconnect();
});

test("OrderService timeout path rechecks order and cancels when requested", async () => {
  let cancelOrderCalls = 0;
  const context = createTestContext({
    overrides: {
      async cancelOrder(): Promise<{ cancelled?: string[] }> {
        cancelOrderCalls += 1;
        return { cancelled: ["order-timeout"] };
      },
      async createAndPostMarketOrder(): Promise<{ success?: boolean; orderID?: string }> {
        return { success: true, orderID: "order-timeout" };
      },
      async getTrades(): Promise<Array<{ status: string; taker_order_id?: string; maker_orders?: { order_id: string }[] }>> {
        return [{ status: "MATCHED", taker_order_id: "order-timeout", maker_orders: [] }];
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  const confirmation = await context.service.waitForOrderConfirmation({ order: postedOrder!, timeoutMs: 10, shouldCancelOnTimeout: true });

  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.status, "failed");
  assert.equal(cancelOrderCalls > 0, true);
  await context.service.disconnect();
});

test("OrderService lists active orders pending confirmation", async () => {
  const context = createTestContext({
    overrides: {
      async getOpenOrders(): Promise<Array<{ id: string; status: string; owner: string; maker_address: string; market: string; asset_id: string; side: string; original_size: string; size_matched: string; price: string; associate_trades: string[]; outcome: string; created_at: number; expiration: string; order_type: string }>> {
        return [{ id: "open-1", status: "LIVE", owner: "owner-1", maker_address: "maker-1", market: "market-1", asset_id: "asset-1", side: "BUY", original_size: "5", size_matched: "0", price: "0.43", associate_trades: [], outcome: "Yes", created_at: 1, expiration: "2", order_type: "GTC" }];
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const activeOrders = await context.service.listActiveOrdersPendingConfirmation();

  assert.equal(activeOrders.length, 1);
  assert.equal(activeOrders[0]!.id, "open-1");
  await context.service.disconnect();
});

test("OrderService cancels an order by id", async () => {
  let cancelledOrderId: string | null = null;
  const context = createTestContext({
    overrides: {
      async cancelOrder(input: { orderID: string }): Promise<{ cancelled?: string[] }> {
        cancelledOrderId = input.orderID;
        return { cancelled: [input.orderID] };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const isCancelled = await context.service.cancelOrderById("order-cancelled");

  assert.equal(cancelledOrderId, "order-cancelled");
  assert.equal(isCancelled, true);
  await context.service.disconnect();
});

test("OrderService maker sell caps size with sellable balance", async () => {
  let postedSize = 0;
  const context = createTestContext({
    overrides: {
      async getBalanceAllowance(): Promise<{ balance?: string }> {
        return { balance: "1500000" };
      },
      async createAndPostOrder(order: Record<string, unknown>): Promise<{ success?: boolean; orderID?: string }> {
        postedSize = Number(order.size ?? 0);
        return { success: true, orderID: "maker-sell-order" };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 2, price: 0.55, direction: "up", op: "sell", executionType: "maker" });

  assert.equal(postedOrder!.id, "maker-sell-order");
  assert.equal(postedOrder!.size, 1.5);
  assert.equal(postedSize, 1.5);
  await context.service.disconnect();
});

test("OrderService taker sell cancels opposite orders and uses sellable amount", async () => {
  const canceledInputs: Array<{ market: string; asset_id: string }> = [];
  let postedAmount = 0;
  const context = createTestContext({
    overrides: {
      async getBalanceAllowance(): Promise<{ balance?: string }> {
        return { balance: "1200000" };
      },
      async cancelMarketOrders(input: { market: string; asset_id: string }): Promise<{ cancelled?: string[] }> {
        canceledInputs.push(input);
        return { cancelled: ["x"] };
      },
      async createAndPostMarketOrder(order: Record<string, unknown>): Promise<{ success?: boolean; orderID?: string }> {
        postedAmount = Number(order.amount ?? 0);
        return { success: true, orderID: "taker-sell-order" };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 2, price: 0.51, direction: "down", op: "sell", executionType: "taker" });

  assert.equal(postedOrder!.id, "taker-sell-order");
  assert.equal(postedOrder!.size, 1.2);
  assert.equal(postedAmount, 1.2);
  assert.deepEqual(canceledInputs[0], { market: "condition-1", asset_id: "up-token" });
  await context.service.disconnect();
});

test("OrderService paper mode avoids posting and confirms after delay", async () => {
  const context = createTestContext({
    overrides: {
      async createAndPostOrder(): Promise<{ success?: boolean; orderID?: string }> {
        throw new Error("should not post maker order in paper mode");
      },
      async createAndPostMarketOrder(): Promise<{ success?: boolean; orderID?: string }> {
        throw new Error("should not post taker order in paper mode");
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", paperMode: true });
  const confirmation = await context.service.waitForOrderConfirmation({ order: postedOrder!, timeoutMs: 5 });

  assert.equal(typeof postedOrder!.id, "string");
  assert.equal(confirmation.status, "confirmed");
  await context.service.disconnect();
});

test("OrderService failed trade event resolves as failed confirmation", async () => {
  const context = createTestContext({
    overrides: {
      async createAndPostMarketOrder(): Promise<{ success?: boolean; orderID?: string }> {
        return { success: true, orderID: "order-failed" };
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  const confirmationPromise = context.service.waitForOrderConfirmation({ order: postedOrder!, timeoutMs: 500 });
  context.sockets[0]!.emit("message", JSON.stringify({ event_type: "trade", status: "FAILED", taker_order_id: "order-failed", maker_orders: [] }));
  const confirmation = await confirmationPromise;

  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.status, "failed");
  await context.service.disconnect();
});

test("OrderService rechecks pending order on reconnect and resolves as confirmed", async () => {
  const context = createTestContext({
    overrides: {
      async createAndPostMarketOrder(): Promise<{ success?: boolean; orderID?: string }> {
        return { success: true, orderID: "order-reconnect" };
      },
      async getTrades(): Promise<Array<{ status: string; taker_order_id?: string; maker_orders?: { order_id: string }[] }>> {
        return [{ status: "CONFIRMED", taker_order_id: "order-reconnect", maker_orders: [] }];
      }
    }
  });
  await context.service.init({ privateKey: "0xabc" });

  const postedOrder = await context.service.postOrder({ market: createMarket(), size: 1, price: 0.5, direction: "up", op: "buy", executionType: "taker" });
  const confirmationPromise = context.service.waitForOrderConfirmation({ order: postedOrder!, timeoutMs: 500 });
  context.sockets[0]!.close();
  const confirmation = await confirmationPromise;

  assert.equal(context.sockets.length > 1, true);
  assert.equal(confirmation.status, "confirmed");
  await context.service.disconnect();
});

test("OrderService rejects unsafe taker buy amount", async () => {
  const context = createTestContext();
  await context.service.init({ privateKey: "0xabc" });

  await assert.rejects(
    async () => context.service.postOrder({ market: createMarket(), size: 10, price: 0.9, direction: "up", op: "buy", executionType: "taker" }),
    /safe limit/
  );
  await context.service.disconnect();
});

test("OrderService sends PING heartbeat frames on user websocket", async () => {
  const sleepCalls: number[] = [];
  const sleepResolvers: Array<() => void> = [];
  const clock: Clock = {
    now(): number {
      const now = Date.now();
      return now;
    },
    async sleep(milliseconds: number): Promise<void> {
      sleepCalls.push(milliseconds);
      await new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    }
  };
  const context = createTestContext({ clock });
  await context.service.init({ privateKey: "0xabc" });

  assert.equal(sleepCalls[0], config.WS_HEARTBEAT_INTERVAL_MS);
  sleepResolvers[0]!();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(context.sockets[0]!.sentPayloads.includes("PING"), true);
  await context.service.disconnect();
});
