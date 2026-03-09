import * as assert from "node:assert/strict";
import { test } from "node:test";

import { MarketStreamParserService } from "../src/stream/market-stream-parser.service.ts";

test("MarketStreamParserService parses array payloads and sorts book levels", () => {
  const parser = MarketStreamParserService.create();

  const events = parser.parse(
    JSON.stringify([
      {
        event_type: "book",
        asset_id: "token-a",
        timestamp: "1767225900001",
        bids: [
          { price: "0.45", size: "5" },
          { price: "0.49", size: "1" }
        ],
        asks: [
          { price: "0.55", size: "9" },
          { price: "0.52", size: "3" }
        ]
      },
      { event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900002", price: "0.53" }
    ])
  );

  assert.equal(events.length, 2);
  assert.equal(events[0]!.type, "book");
  assert.deepEqual((events[0] as { bids: unknown }).bids, [
    { price: 0.49, size: 1 },
    { price: 0.45, size: 5 }
  ]);
  assert.deepEqual((events[0] as { asks: unknown }).asks, [
    { price: 0.52, size: 3 },
    { price: 0.55, size: 9 }
  ]);
  assert.equal(events[1]!.type, "price");
  assert.equal(events[1]!.index, 2);
});

test("MarketStreamParserService throws contextual error on invalid JSON", () => {
  const parser = MarketStreamParserService.create();

  assert.throws(() => parser.parse("{not-json"), /Failed to parse market stream payload/);
});

test("MarketStreamParserService ignores unsupported event payloads", () => {
  const parser = MarketStreamParserService.create();

  const events = parser.parse(JSON.stringify([{ event_type: "heartbeat", asset_id: "token-a" }]));

  assert.deepEqual(events, []);
});

test("MarketStreamParserService ignores plain-text PONG heartbeat frames", () => {
  const parser = MarketStreamParserService.create();

  const events = parser.parse("PONG");

  assert.deepEqual(events, []);
});
