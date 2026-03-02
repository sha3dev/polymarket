import { strict as assert } from "node:assert";
import { test } from "node:test";

import { MarketStreamParser } from "../src/stream/market-stream-parser.ts";
import { MarketStreamProtocolError } from "../src/stream/market-stream-protocol-error.ts";

test("MarketStreamParser parses array payloads and sorts book levels", () => {
  const parser = MarketStreamParser.create();

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
  assert.deepEqual((events[0] as { bids: unknown; asks: unknown }).bids, [
    { price: 0.49, size: 1 },
    { price: 0.45, size: 5 }
  ]);
  assert.deepEqual((events[0] as { bids: unknown; asks: unknown }).asks, [
    { price: 0.52, size: 3 },
    { price: 0.55, size: 9 }
  ]);
  assert.equal(events[1]!.type, "price");
  assert.equal(events[1]!.index, 2);
});

test("MarketStreamParser throws typed protocol error on invalid JSON", () => {
  const parser = MarketStreamParser.create();

  assert.throws(
    () => {
      parser.parse("{not-json");
    },
    (error: unknown) => {
      const matches = error instanceof MarketStreamProtocolError;
      return matches;
    }
  );
});

test("MarketStreamParser ignores unsupported event payloads", () => {
  const parser = MarketStreamParser.create();

  const events = parser.parse(JSON.stringify([{ event_type: "heartbeat", asset_id: "token-a" }]));

  assert.deepEqual(events, []);
});
