import * as assert from "node:assert/strict";
import { test } from "node:test";

import { MarketCatalogService } from "../src/market/market-catalog.service.ts";

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
  const service = new MarketCatalogService({
    httpClient: {
      async fetch(): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const response = { ok: true, status: 200, statusText: "OK", async json(): Promise<unknown> { return payload; } };
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

test("loadMarketBySlug throws contextual error for non-200 response", async () => {
  const service = new MarketCatalogService({
    httpClient: {
      async fetch(): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const response = { ok: false, status: 503, statusText: "Service Unavailable", async json(): Promise<unknown> { return {}; } };
        return response;
      }
    }
  });

  await assert.rejects(async () => service.loadMarketBySlug({ slug: "btc-updown-5m-123" }), /btc-updown-5m-123.*503/);
});

test("loadMarketBySlug throws contextual normalization error when up/down outcomes are missing", async () => {
  const payload = {
    id: "m2",
    slug: "eth-updown-5m-123",
    conditionId: "condition-2",
    outcomes: '["YES","NO"]',
    clobTokenIds: '["token-yes","token-no"]',
    eventStartTime: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T00:05:00.000Z"
  };
  const service = new MarketCatalogService({
    httpClient: {
      async fetch(): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const response = { ok: true, status: 200, statusText: "OK", async json(): Promise<unknown> { return payload; } };
        return response;
      }
    }
  });

  await assert.rejects(async () => service.loadMarketBySlug({ slug: "eth-updown-5m-123" }), /eth-updown-5m-123/);
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
  const requestedSlugs: string[] = [];
  const service = new MarketCatalogService({
    httpClient: {
      async fetch(url: string): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        const slug = String(url.split("/").pop());
        requestedSlugs.push(slug);
        const response = { ok: true, status: 200, statusText: "OK", async json(): Promise<unknown> { return payloadBySlug[slug]!; } };
        return response;
      }
    }
  });

  const markets = await service.loadMarketsBySlugs({ slugs: ["btc-updown-5m-123", "eth-updown-5m-123"] });

  assert.deepEqual(requestedSlugs, ["btc-updown-5m-123", "eth-updown-5m-123"]);
  assert.equal(markets.length, 2);
  assert.equal(markets[0]!.slug, "btc-updown-5m-123");
  assert.equal(markets[1]!.slug, "eth-updown-5m-123");
});

test("buildCryptoWindowSlugs creates UTC-window aligned slugs for 5m and selected symbols", () => {
  const service = MarketCatalogService.createDefault();

  const slugs = service.buildCryptoWindowSlugs({ date: new Date("2026-01-01T00:07:33.000Z"), window: "5m", symbols: ["btc", "sol"] });

  assert.deepEqual(slugs, ["btc-updown-5m-1767225900", "sol-updown-5m-1767225900"]);
});

test("buildCryptoWindowSlugs includes xrp in default symbol set", () => {
  const service = MarketCatalogService.createDefault();

  const slugs = service.buildCryptoWindowSlugs({ date: new Date("2026-01-01T00:07:33.000Z"), window: "5m" });

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
  const requestedUrls: string[] = [];
  const service = new MarketCatalogService({
    httpClient: {
      async fetch(url: string): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        requestedUrls.push(url);
        const response = { ok: true, status: 200, statusText: "OK", async json(): Promise<unknown> { return payload; } };
        return response;
      }
    }
  });

  const markets = await service.loadCryptoWindowMarkets({ date: new Date("2026-01-01T00:07:33.000Z"), window: "5m", symbols: ["btc"] });

  assert.equal(requestedUrls.length, 1);
  assert.equal(markets.length, 1);
  assert.equal(markets[0]!.slug, "btc-updown-5m-1767225900");
});

test("getPriceToBeat builds the price endpoint URL and returns openPrice", async () => {
  const requestedUrls: string[] = [];
  const service = new MarketCatalogService({
    httpClient: {
      async fetch(url: string): Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }> {
        requestedUrls.push(url);
        const response = { ok: true, status: 200, statusText: "OK", async json(): Promise<unknown> { return { openPrice: 90_123.45 }; } };
        return response;
      }
    }
  });
  const market = {
    id: "m1",
    slug: "btc-updown-5m-1767225900",
    question: "BTC up?",
    symbol: "btc" as const,
    conditionId: "condition-1",
    outcomes: ["Up", "Down"],
    clobTokenIds: ["token-up", "token-down"],
    upTokenId: "token-up",
    downTokenId: "token-down",
    orderMinSize: 1,
    orderPriceMinTickSize: "0.01",
    eventStartTime: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-01T00:05:00.000Z",
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2026-01-01T00:05:00.000Z"),
    raw: {}
  };

  const priceToBeat = await service.getPriceToBeat({ market });

  assert.equal(priceToBeat, 90_123.45);
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0]?.includes("symbol=BTC"), true);
  assert.equal(requestedUrls[0]?.includes("variant=fiveminute"), true);
  assert.equal(requestedUrls[0]?.includes("eventStartTime=2026-01-01T00%3A00%3A00.000Z"), true);
  assert.equal(requestedUrls[0]?.includes("endDate=2026-01-01T00%3A05%3A00.000Z"), true);
});
