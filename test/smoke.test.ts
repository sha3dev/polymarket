import { strict as assert } from "node:assert";
import { test } from "node:test";

import { PolymarketClient } from "../src/index.ts";

test("smoke: public entrypoint exports PolymarketClient", () => {
  assert.equal(typeof PolymarketClient, "function");
});
