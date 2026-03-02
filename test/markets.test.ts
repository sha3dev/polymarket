import { strict as assert } from "node:assert";
import { test } from "node:test";

import { GammaMarketCatalogService } from "../src/markets/gamma-market-catalog-service.ts";
import { MarketLoadError } from "../src/markets/market-load-error.ts";
import { MarketNormalizationError } from "../src/markets/market-normalization-error.ts";

test("loadMarketBySlug normalizes Gamma payload and resolves up/down tokens", async () => {
  const payload = {
    id: "m1",
    slug: "btc-updown-5m-123",
    question: "BTC up?",
    conditionId: "condition-1",
    outcomes: '["Up","Down"]',
    clobTokenIds: '["token-up","token-down"]',
    eventStartTime: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T00:05:00.000Z",
    orderMinSize: "1",
    orderPriceMinTickSize: "0.01"
  };
  const service = GammaMarketCatalogService.create({
    httpClient: {
      async fetch(): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const response = {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return payload;
          }
        };
        return response;
      }
    }
  });

  const market = await service.loadMarketBySlug({ slug: "btc-updown-5m-123" });

  assert.equal(market.symbol, "btc");
  assert.equal(market.upTokenId, "token-up");
  assert.equal(market.downTokenId, "token-down");
  assert.equal(market.orderMinSize, 1);
});

test("loadMarketBySlug throws typed load error for non-200 response", async () => {
  const service = GammaMarketCatalogService.create({
    httpClient: {
      async fetch(): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const response = {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          async json() {
            return {};
          }
        };
        return response;
      }
    }
  });

  await assert.rejects(
    async () => {
      await service.loadMarketBySlug({ slug: "btc-updown-5m-123" });
    },
    (error: unknown) => {
      const matches = error instanceof MarketLoadError;
      return matches;
    }
  );
});

test("loadMarketBySlug throws typed normalization error when up/down outcomes are missing", async () => {
  const payload = {
    id: "m2",
    slug: "eth-updown-5m-123",
    conditionId: "condition-2",
    outcomes: '["YES","NO"]',
    clobTokenIds: '["token-yes","token-no"]',
    eventStartTime: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T00:05:00.000Z"
  };
  const service = GammaMarketCatalogService.create({
    httpClient: {
      async fetch(): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const response = {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return payload;
          }
        };
        return response;
      }
    }
  });

  await assert.rejects(
    async () => {
      await service.loadMarketBySlug({ slug: "eth-updown-5m-123" });
    },
    (error: unknown) => {
      const matches = error instanceof MarketNormalizationError;
      return matches;
    }
  );
});

test("loadMarketsBySlugs fetches all requested slugs in order", async () => {
  const payloadBySlug: Record<string, unknown> = {
    "btc-updown-5m-123": {
      id: "m1",
      slug: "btc-updown-5m-123",
      question: "BTC up?",
      conditionId: "condition-1",
      outcomes: '["Up","Down"]',
      clobTokenIds: '["token-up","token-down"]',
      eventStartTime: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-01T00:05:00.000Z"
    },
    "eth-updown-5m-123": {
      id: "m2",
      slug: "eth-updown-5m-123",
      question: "ETH up?",
      conditionId: "condition-2",
      outcomes: '["Up","Down"]',
      clobTokenIds: '["eth-up","eth-down"]',
      eventStartTime: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-01T00:05:00.000Z"
    }
  };
  const calls: string[] = [];
  const service = GammaMarketCatalogService.create({
    httpClient: {
      async fetch(url: string): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const slug = String(url.split("/").pop());
        calls.push(slug);
        const response = {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return payloadBySlug[slug]!;
          }
        };
        return response;
      }
    }
  });

  const markets = await service.loadMarketsBySlugs({ slugs: ["btc-updown-5m-123", "eth-updown-5m-123"] });

  assert.deepEqual(calls, ["btc-updown-5m-123", "eth-updown-5m-123"]);
  assert.equal(markets.length, 2);
  assert.equal(markets[0]!.slug, "btc-updown-5m-123");
  assert.equal(markets[1]!.slug, "eth-updown-5m-123");
});

test("buildCryptoWindowSlugs creates UTC-window aligned slugs for 5m and selected symbols", () => {
  const service = GammaMarketCatalogService.create();
  const date = new Date("2026-01-01T00:07:33.000Z");

  const slugs = service.buildCryptoWindowSlugs({ date, window: "5m", symbols: ["btc", "sol"] });

  assert.deepEqual(slugs, ["btc-updown-5m-1767225900", "sol-updown-5m-1767225900"]);
});

test("buildCryptoWindowSlugs includes xrp in default symbol set", () => {
  const service = GammaMarketCatalogService.create();
  const date = new Date("2026-01-01T00:07:33.000Z");

  const slugs = service.buildCryptoWindowSlugs({ date, window: "5m" });

  assert.equal(slugs.includes("xrp-updown-5m-1767225900"), true);
});

test("loadCryptoWindowMarkets delegates slug build and market loading", async () => {
  const payload = {
    id: "m1",
    slug: "btc-updown-5m-1767225900",
    question: "BTC up?",
    conditionId: "condition-1",
    outcomes: '["Up","Down"]',
    clobTokenIds: '["token-up","token-down"]',
    eventStartTime: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T00:05:00.000Z"
  };
  const calls: string[] = [];
  const service = GammaMarketCatalogService.create({
    httpClient: {
      async fetch(url: string): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        calls.push(url);
        const response = {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return payload;
          }
        };
        return response;
      }
    }
  });

  const markets = await service.loadCryptoWindowMarkets({ date: new Date("2026-01-01T00:07:33.000Z"), window: "5m", symbols: ["btc"] });

  assert.equal(calls.length, 1);
  assert.equal(markets.length, 1);
  assert.equal(markets[0]!.slug, "btc-updown-5m-1767225900");
});
