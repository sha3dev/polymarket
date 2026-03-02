import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { Logger } from "../src/shared/contracts.ts";
import { OrderConfirmationTracker } from "../src/orders/order-confirmation-tracker.ts";

function createLogger(messages: string[]): Logger {
  const logger: Logger = {
    debug(message: string): void {
      messages.push(`debug:${message}`);
    },
    info(): void {
      // empty
    },
    warn(message: string): void {
      messages.push(`warn:${message}`);
    },
    error(): void {
      // empty
    }
  };
  return logger;
}

test("OrderConfirmationTracker emits confirmed trade status for tracked taker order", () => {
  const logs: string[] = [];
  const tracker = OrderConfirmationTracker.create(createLogger(logs));
  tracker.markOrderInProcess("order-1");

  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message) => {
    received.push(message);
  });
  tracker.processUserStreamMessage(JSON.stringify({ event_type: "trade", status: "CONFIRMED", taker_order_id: "order-1", maker_orders: [] }));

  assert.deepEqual(received, [{ id: "order-1", status: "confirmed" }]);
});

test("OrderConfirmationTracker resolves tracked maker order id and ignores pending statuses", () => {
  const logs: string[] = [];
  const tracker = OrderConfirmationTracker.create(createLogger(logs));
  tracker.markOrderInProcess("maker-2");

  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message) => {
    received.push(message);
  });

  tracker.processUserStreamMessage(
    JSON.stringify({ event_type: "trade", status: "MATCHED", taker_order_id: "other", maker_orders: [{ order_id: "maker-2" }] })
  );
  tracker.processUserStreamMessage(JSON.stringify({ event_type: "trade", status: "FAILED", taker_order_id: "other", maker_orders: [{ order_id: "maker-2" }] }));

  assert.deepEqual(received, [{ id: "maker-2", status: "failed" }]);
});

test("OrderConfirmationTracker emits cancelled status for order cancellation event", () => {
  const logs: string[] = [];
  const tracker = OrderConfirmationTracker.create(createLogger(logs));

  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message) => {
    received.push(message);
  });
  tracker.processUserStreamMessage(JSON.stringify({ event_type: "order", id: "order-cancelled", type: "CANCELLATION" }));

  assert.deepEqual(received, [{ id: "order-cancelled", status: "cancelled" }]);
});

test("OrderConfirmationTracker logs and ignores non-json messages", () => {
  const logs: string[] = [];
  const tracker = OrderConfirmationTracker.create(createLogger(logs));
  tracker.processUserStreamMessage("{bad-json");

  assert.equal(
    logs.some((item) => item.includes("Ignoring non-JSON user stream message")),
    true
  );
});

test("OrderConfirmationTracker catches reconnect listener errors and keeps processing", async () => {
  const logs: string[] = [];
  const tracker = OrderConfirmationTracker.create(createLogger(logs));
  let okListenerCalled = false;

  tracker.addReconnectListener(async () => {
    throw new Error("boom");
  });
  tracker.addReconnectListener(async () => {
    okListenerCalled = true;
  });

  await tracker.emitReconnect();

  assert.equal(okListenerCalled, true);
  assert.equal(
    logs.some((item) => item.includes("Reconnect listener failed")),
    true
  );
});
