import * as assert from "node:assert/strict";
import { test } from "node:test";

import { PolymarketClient } from "../src/client/polymarket-client.service.ts";
import { MarketCatalogService } from "../src/market/market-catalog.service.ts";
import { OrderService } from "../src/order/order.service.ts";
import { MarketStreamService } from "../src/stream/market-stream.service.ts";

test("PolymarketClient exposes feature services and delegates connect/disconnect", async () => {
  let connectCalls = 0;
  let disconnectCalls = 0;
  let orderDisconnectCalls = 0;
  const stream = MarketStreamService.createDefault();
  const orders = OrderService.createDefault();
  stream.connect = async (): Promise<void> => {
    connectCalls += 1;
  };
  stream.disconnect = async (): Promise<void> => {
    disconnectCalls += 1;
  };
  orders.disconnect = async (): Promise<void> => {
    orderDisconnectCalls += 1;
  };
  const markets = MarketCatalogService.createDefault();
  const client = PolymarketClient.createDefault({ markets, stream, orders });

  await client.connect();
  await client.disconnect();

  assert.equal(client.markets, markets);
  assert.equal(client.stream, stream);
  assert.equal(client.orders, orders);
  assert.equal(connectCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.equal(orderDisconnectCalls, 1);
});

test("PolymarketClient passes stream connect options", async () => {
  let reconnectDelayMs: number | null = null;
  const stream = MarketStreamService.createDefault();
  stream.connect = async (options): Promise<void> => {
    reconnectDelayMs = options?.reconnectDelayMs ?? null;
  };
  const client = PolymarketClient.createDefault({ stream, streamConnectOptions: { reconnectDelayMs: 321 } });

  await client.connect();

  assert.equal(reconnectDelayMs, 321);
});
