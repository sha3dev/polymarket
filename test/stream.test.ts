import { strict as assert } from "node:assert";
import { test } from "node:test";

import CONFIG from "../src/config.ts";
import type { Clock, WebSocketFactory, WebSocketLike } from "../src/shared/contracts.ts";
import { MarketStreamConnectionError } from "../src/stream/market-stream-connection-error.ts";
import { MarketStreamService } from "../src/stream/market-stream-service.ts";
import type { MarketEvent } from "../src/stream/stream-types.ts";

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
  await service.disconnect();
});

test("MarketStreamService writes received stream events to console during test run", async () => {
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
  const receivedEvents: MarketEvent[] = [];

  service.addListener({
    listener(event) {
      receivedEvents.push(event);
      console.log(`[TEST STREAM EVENT] ${JSON.stringify(event)}`);
    }
  });

  await service.connect();
  sockets[0]!.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900000", price: "0.53" }));
  sockets[0]!.emit(
    "message",
    JSON.stringify({
      event_type: "book",
      asset_id: "token-a",
      timestamp: "1767225900001",
      bids: [{ price: "0.49", size: "15" }],
      asks: [{ price: "0.55", size: "12" }]
    })
  );

  assert.equal(receivedEvents.length, 2);
  await service.disconnect();
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

test("MarketStreamService sends PING heartbeat frames on open socket", async () => {
  const sockets: FakeWebSocket[] = [];
  const sleepCalls: number[] = [];
  const sleepResolvers: Array<() => void> = [];
  const clock: Clock = {
    now() {
      return Date.now();
    },
    async sleep(milliseconds) {
      sleepCalls.push(milliseconds);
      await new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    }
  };
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
  const service = MarketStreamService.create({ webSocketFactory, clock });

  await service.connect();
  assert.equal(sleepCalls[0], CONFIG.WS_HEARTBEAT_INTERVAL_MS);
  sleepResolvers[0]!();
  await new Promise<void>((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });
  assert.equal(sockets[0]!.sentPayloads.includes("PING"), true);

  await service.disconnect();
});

test("MarketStreamService stays connected for at least 5 minutes without reconnecting", async () => {
  const sockets: FakeWebSocket[] = [];
  const sleepCalls: number[] = [];
  const sleepResolvers: Array<() => void> = [];
  let createCalls = 0;
  const clock: Clock = {
    now() {
      return Date.now();
    },
    async sleep(milliseconds) {
      sleepCalls.push(milliseconds);
      await new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    }
  };
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      createCalls += 1;
      const socket = new FakeWebSocket();
      sockets.push(socket);
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = MarketStreamService.create({ webSocketFactory, clock });
  const heartbeatCycles = Math.ceil((5 * 60 * 1000) / CONFIG.WS_HEARTBEAT_INTERVAL_MS);

  await service.connect();
  for (let cycleIndex = 0; cycleIndex < heartbeatCycles; cycleIndex += 1) {
    while (sleepResolvers.length <= cycleIndex) {
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          resolve();
        });
      });
    }
    assert.equal(sleepCalls[cycleIndex], CONFIG.WS_HEARTBEAT_INTERVAL_MS);
    sleepResolvers[cycleIndex]!();
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        resolve();
      });
    });
  }

  const pingCount = sockets[0]!.sentPayloads.filter((payload) => payload === "PING").length;
  assert.equal(createCalls, 1);
  assert.equal(sockets.length, 1);
  assert.equal(pingCount >= heartbeatCycles, true);

  await service.disconnect();
});

test("MarketStreamService uses immediate first reconnect and jittered delays after failed retries", async () => {
  const sockets: FakeWebSocket[] = [];
  const reconnectPhases: string[] = [];
  const sleepDurations: number[] = [];
  let createCount = 0;
  const clock: Clock = {
    now() {
      return Date.now();
    },
    async sleep(milliseconds) {
      if (milliseconds === CONFIG.WS_HEARTBEAT_INTERVAL_MS) {
        await new Promise<void>(() => {
          // Keep heartbeat loop parked in this test.
        });
      }
      if (milliseconds !== CONFIG.WS_HEARTBEAT_INTERVAL_MS) {
        reconnectPhases.push(`sleep:${milliseconds}`);
        sleepDurations.push(milliseconds);
      }
    }
  };
  const webSocketFactory: WebSocketFactory = {
    create(): WebSocketLike {
      const callIndex = createCount;
      createCount += 1;
      reconnectPhases.push(`create:${callIndex}`);
      if (callIndex === 1 || callIndex === 2) {
        throw new Error("temporary reconnect error");
      }
      const socket = new FakeWebSocket();
      sockets.push(socket);
      setImmediate(() => {
        socket.readyState = socket.OPEN;
        socket.emit("open");
      });
      return socket;
    }
  };
  const service = MarketStreamService.create({ webSocketFactory, clock });

  await service.connect({ reconnectDelayMs: 40 });
  sockets[0]!.close();
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 30);
  });

  assert.deepEqual(reconnectPhases.slice(0, 2), ["create:0", "create:1"]);
  assert.equal(reconnectPhases[2]!.startsWith("sleep:"), true);
  assert.equal(reconnectPhases[3], "create:2");
  assert.equal(reconnectPhases[4]!.startsWith("sleep:"), true);
  assert.equal(reconnectPhases[5], "create:3");
  assert.equal(sleepDurations.length, 2);
  for (const delay of sleepDurations) {
    assert.equal(delay >= 20 && delay <= 60, true);
  }

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
