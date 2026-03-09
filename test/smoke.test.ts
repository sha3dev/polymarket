import * as assert from "node:assert/strict";
import { test } from "node:test";

import { MarketCatalogService, MarketStreamService, OrderService, PackageInfoService, PolymarketClient } from "../src/index.ts";

test("smoke: public entrypoint exports rebuilt package services", () => {
  assert.equal(typeof PolymarketClient, "function");
  assert.equal(typeof MarketCatalogService, "function");
  assert.equal(typeof MarketStreamService, "function");
  assert.equal(typeof OrderService, "function");
  assert.equal(typeof PackageInfoService, "function");
});
