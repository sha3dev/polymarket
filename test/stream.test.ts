import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { Clock, WebSocketFactory, WebSocketLike } from "../src/shared/contracts.ts";
import { MarketStreamConnectionError } from "../src/stream/market-stream-connection-error.ts";
import { MarketStreamService } from "../src/stream/market-stream-service.ts";

class FakeWebSocket implements WebSocketLike {
  public readonly OPEN = 1;
  public readonly CLOSED = 3;
  public readyState = 0;
  public readonly sentPayloads: string[] = [];
  private readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = { open: [], close: [], error: [], message: [] };

  public on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void {
    const eventListeners = this.listeners[event] ?? [];
    eventListeners.push(listener);
    this.listeners[event] = eventListeners;
  }

  public send(data: string): void {
    this.sentPayloads.push(data);
  }

  public close(): void {
    if (this.readyState !== this.CLOSED) {
      this.readyState = this.CLOSED;
      this.emit("close");
    }
  }

  public emit(event: "open" | "close" | "error" | "message", ...args: unknown[]): void {
    const eventListeners = this.listeners[event] ?? [];
    for (const listener of eventListeners) {
      listener(...args);
    }
  }
}

test("MarketStreamService subscribes/unsubscribes and updates asset cache from messages", async () => {
  const sockets: FakeWebSocket[] = [];
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = MarketStreamService.create({ webSocketFactory });

  await service.connect();
  service.subscribe({ assetIds: ["token-a"] });

  assert.equal(sockets.length > 0, true);
  const firstSocket = sockets[0]!;
  assert.equal(firstSocket.sentPayloads.length > 0, true);

  firstSocket.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900000", price: "0.53" }));
  firstSocket.emit(
    "message",
    JSON.stringify({
      event_type: "book",
      asset_id: "token-a",
      timestamp: "1767225900001",
      bids: [{ price: "0.49", size: "15" }],
      asks: [{ price: "0.55", size: "12" }]
    })
  );

  assert.equal(service.getAssetPrice({ assetId: "token-a" }), 0.53);
  assert.deepEqual(service.getAssetOrderBook({ assetId: "token-a" }), { bids: [{ price: 0.49, size: 15 }], asks: [{ price: 0.55, size: 12 }] });

  service.unsubscribe({ assetIds: ["token-a"] });

  const hasUnsubscribePayload = firstSocket.sentPayloads.some((payload) => {
    return payload.includes('"operation":"unsubscribe"');
  });
  assert.equal(hasUnsubscribePayload, true);

  await service.disconnect();
});

test("MarketStreamService forwards parsed events to listeners and remove handler works", async () => {
  const sockets: FakeWebSocket[] = [];
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = MarketStreamService.create({ webSocketFactory });
  const receivedTypes: string[] = [];
  const remove = service.addListener({
    listener(event) {
      receivedTypes.push(event.type);
    }
  });

  await service.connect();
  sockets[0]!.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900000", price: "0.53" }));
  remove();
  sockets[0]!.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900001", price: "0.54" }));

  assert.deepEqual(receivedTypes, ["price"]);
});

test("MarketStreamService reconnects and re-subscribes desired assets", async () => {
  const sockets: FakeWebSocket[] = [];
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = MarketStreamService.create({ webSocketFactory });

  await service.connect();
  service.subscribe({ assetIds: ["token-a"] });
  const firstSocket = sockets[0]!;
  firstSocket.close();
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 20);
  });

  assert.equal(sockets.length >= 2, true);
  const hasSubscribePayload = sockets.slice(1).some((socket) => {
    return socket.sentPayloads.some((payload) => payload.includes('"operation":"subscribe"') && payload.includes("token-a"));
  });
  assert.equal(hasSubscribePayload, true);

  await service.disconnect();
});

test("MarketStreamService wraps websocket creation errors with typed connection error", async () => {
  let sleepCalls = 0;
  const clock: Clock = {
    now() {
      return Date.now();
    },
    async sleep() {
      sleepCalls += 1;
    }
  };
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      throw new Error("socket down");
    }
  };
  const service = MarketStreamService.create({ webSocketFactory, clock });

  await assert.rejects(
    async () => {
      await service.connect({ reconnectDelayMs: 1 });
    },
    (error: unknown) => {
      const matches = error instanceof MarketStreamConnectionError;
      return matches;
    }
  );

  assert.equal(sleepCalls, 0);
});
