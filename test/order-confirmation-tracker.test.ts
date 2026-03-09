import * as assert from "node:assert/strict";
import { test } from "node:test";

import { OrderConfirmationTrackerService } from "../src/order/order-confirmation-tracker.service.ts";

test("OrderConfirmationTrackerService emits confirmed trade status for tracked taker order", () => {
  const tracker = OrderConfirmationTrackerService.create();
  tracker.markOrderInProcess("order-1");

  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message): void => {
    received.push(message);
  });
  tracker.processUserStreamMessage(JSON.stringify({ event_type: "trade", status: "CONFIRMED", taker_order_id: "order-1", maker_orders: [] }));

  assert.deepEqual(received, [{ id: "order-1", status: "confirmed" }]);
});

test("OrderConfirmationTrackerService resolves tracked maker order id and ignores pending statuses", () => {
  const tracker = OrderConfirmationTrackerService.create();
  tracker.markOrderInProcess("maker-2");

  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message): void => {
    received.push(message);
  });

  tracker.processUserStreamMessage(JSON.stringify({ event_type: "trade", status: "MATCHED", taker_order_id: "other", maker_orders: [{ order_id: "maker-2" }] }));
  tracker.processUserStreamMessage(JSON.stringify({ event_type: "trade", status: "FAILED", taker_order_id: "other", maker_orders: [{ order_id: "maker-2" }] }));

  assert.deepEqual(received, [{ id: "maker-2", status: "failed" }]);
});

test("OrderConfirmationTrackerService emits cancelled status for order cancellation event", () => {
  const tracker = OrderConfirmationTrackerService.create();

  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message): void => {
    received.push(message);
  });
  tracker.processUserStreamMessage(JSON.stringify({ event_type: "order", id: "order-cancelled", type: "CANCELLATION" }));

  assert.deepEqual(received, [{ id: "order-cancelled", status: "cancelled" }]);
});

test("OrderConfirmationTrackerService ignores non-json messages", () => {
  const tracker = OrderConfirmationTrackerService.create();
  const received: Array<{ id: string; status: string }> = [];
  tracker.addOrderListener((message): void => {
    received.push(message);
  });

  tracker.processUserStreamMessage("{bad-json");

  assert.deepEqual(received, []);
});

test("OrderConfirmationTrackerService catches reconnect listener errors and keeps processing", async () => {
  const tracker = OrderConfirmationTrackerService.create();
  let hasOkListenerRun = false;

  tracker.addReconnectListener(async (): Promise<void> => {
    throw new Error("boom");
  });
  tracker.addReconnectListener(async (): Promise<void> => {
    hasOkListenerRun = true;
  });

  await tracker.emitReconnect();

  assert.equal(hasOkListenerRun, true);
});
