import { strict as assert } from "node:assert";

import { GammaMarketCatalogService } from "../src/markets/gamma-market-catalog-service.ts";
import type { PolymarketMarket } from "../src/markets/market-types.ts";
import { createDefaultWebSocketFactory } from "../src/shared/defaults.ts";
import type { WebSocketFactory, WebSocketLike } from "../src/shared/contracts.ts";
import { MarketStreamService } from "../src/stream/market-stream-service.ts";
import type { MarketEvent } from "../src/stream/stream-types.ts";

function createCountingWebSocketFactory(): { factory: WebSocketFactory; getCreateCalls: () => number } {
  let createCalls = 0;
  const baseFactory = createDefaultWebSocketFactory();
  const factory: WebSocketFactory = {
    create(url: string): WebSocketLike {
      createCalls += 1;
      const socket = baseFactory.create(url);
      return socket;
    }
  };
  const getCreateCalls = (): number => {
    const value = createCalls;
    return value;
  };
  const result = { factory, getCreateCalls };
  return result;
}

async function loadActiveMarketsFor5mAnd15m(): Promise<PolymarketMarket[]> {
  const catalog = GammaMarketCatalogService.create();
  const now = new Date();
  const markets5m = await catalog.loadCryptoWindowMarkets({ date: now, window: "5m" });
  const markets15m = await catalog.loadCryptoWindowMarkets({ date: now, window: "15m" });
  const merged = [...markets5m, ...markets15m];
  const activeMarkets = merged.filter((market) => market.end.getTime() > now.getTime());
  return activeMarkets;
}

function getAssetIds(markets: PolymarketMarket[]): string[] {
  const assetIds = new Set<string>();
  for (const market of markets) {
    for (const assetId of market.clobTokenIds) {
      assetIds.add(assetId);
    }
  }
  const result = [...assetIds];
  return result;
}

type StreamEventCounters = { total: number; price: number; book: number; unknown: number };

function createStreamEventCounters(): StreamEventCounters {
  const counters: StreamEventCounters = { total: 0, price: 0, book: 0, unknown: 0 };
  return counters;
}

function consumeStreamEvent(counters: StreamEventCounters, event: MarketEvent): void {
  counters.total += 1;
  if (event.type === "price") {
    counters.price += 1;
  }
  if (event.type === "book") {
    counters.book += 1;
  }
  if (event.type !== "price" && event.type !== "book") {
    counters.unknown += 1;
  }
}

function formatLiveStatus(startedAtMs: number, counters: StreamEventCounters): string {
  const elapsedMs = Date.now() - startedAtMs;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const status = `[REALTIME STREAM TEST] t=${elapsedSec}s events(total=${counters.total} price=${counters.price} book=${counters.book} other=${counters.unknown})`;
  return status;
}

async function runRealTimeStreamCheck(): Promise<void> {
  const startedAt = Date.now();
  const markets = await loadActiveMarketsFor5mAnd15m();
  const assetIds = getAssetIds(markets);
  const countingFactory = createCountingWebSocketFactory();
  const webSocketFactory = countingFactory.factory;
  const service = MarketStreamService.create({ webSocketFactory });
  const counters = createStreamEventCounters();
  const removeListener = service.addListener({
    listener(event) {
      consumeStreamEvent(counters, event);
    }
  });
  const intervalId = setInterval(() => {
    const status = formatLiveStatus(startedAt, counters);
    process.stdout.write(`\r${status}`);
  }, 1000);

  await service.connect();
  service.subscribe({ assetIds });
  console.log(
    `[REALTIME STREAM TEST] startedAt=${new Date(startedAt).toISOString()} markets=${markets.length} assetIds=${assetIds.length} sockets=${countingFactory.getCreateCalls()}`
  );
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 5 * 60 * 1000);
  });
  clearInterval(intervalId);
  process.stdout.write("\n");
  await service.disconnect();
  removeListener();

  const elapsedMs = Date.now() - startedAt;
  const socketsCreated = countingFactory.getCreateCalls();
  assert.equal(assetIds.length > 0, true);
  assert.equal(markets.length > 0, true);
  assert.equal(socketsCreated, 1);
  assert.equal(elapsedMs >= 5 * 60 * 1000, true);
  console.log(
    `[REALTIME STREAM TEST] finishedAt=${new Date().toISOString()} elapsedMs=${elapsedMs} sockets=${socketsCreated} events(total=${counters.total} price=${counters.price} book=${counters.book} other=${counters.unknown})`
  );
}

runRealTimeStreamCheck().catch((error: unknown) => {
  console.error("[REALTIME STREAM TEST] failed", error);
  process.exit(1);
});
