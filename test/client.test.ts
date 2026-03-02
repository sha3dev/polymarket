import { strict as assert } from "node:assert";
import { test } from "node:test";

import { PolymarketClient } from "../src/client/polymarket-client.ts";
import { GammaMarketCatalogService } from "../src/markets/gamma-market-catalog-service.ts";
import { MarketStreamService } from "../src/stream/market-stream-service.ts";
import { OrderService } from "../src/orders/order-service.ts";

test("PolymarketClient exposes feature services and delegates connect/disconnect", async () => {
  let connectCalls = 0;
  let disconnectCalls = 0;
  let orderDisconnectCalls = 0;
  const stream = MarketStreamService.create();
  const orders = OrderService.create();
  stream.connect = async () => {
    connectCalls += 1;
  };
  stream.disconnect = async () => {
    disconnectCalls += 1;
  };
  orders.disconnect = async () => {
    orderDisconnectCalls += 1;
  };
  const markets = GammaMarketCatalogService.create();
  const client = PolymarketClient.create({ markets, stream, orders });

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
  let receivedDelay: number | null = null;
  const stream = MarketStreamService.create();
  stream.connect = async (options) => {
    receivedDelay = options?.reconnectDelayMs ?? null;
  };
  const client = PolymarketClient.create({ stream, streamConnectOptions: { reconnectDelayMs: 321 } });

  await client.connect();

  assert.equal(receivedDelay, 321);
});
