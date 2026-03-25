import * as assert from "node:assert/strict";
import { test } from "node:test";

import config from "../src/config.ts";
import { MarketStreamService } from "../src/stream/market-stream.service.ts";
import type { Clock, WebSocketFactory, WebSocketLike } from "../src/shared/shared-contract.types.ts";

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

  public send(messageText: string): void {
    this.sentPayloads.push(messageText);
  }

  public close(): void {
    if (this.readyState !== this.CLOSED) {
      this.readyState = this.CLOSED;
      this.emit("close");
    }
  }

  public emit(event: "open" | "close" | "error" | "message", ...args: unknown[]): void {
    const eventListeners = this.listeners[event] ?? [];
    for (const eventListener of eventListeners) {
      eventListener(...args);
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
  const service = MarketStreamService.createDefault({ webSocketFactory });

  await service.connect();
  service.subscribe({ assetIds: ["token-a"] });

  const socket = sockets[0]!;
  socket.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900000", price: "0.53" }));
  socket.emit(
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

  assert.equal(socket.sentPayloads.some((payload) => payload.includes('"operation":"unsubscribe"')), true);
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
  const service = MarketStreamService.createDefault({ webSocketFactory });
  const receivedTypes: string[] = [];
  const removeListener = service.addListener({
    listener(event): void {
      receivedTypes.push(event.type);
    }
  });

  await service.connect();
  sockets[0]!.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900000", price: "0.53" }));
  removeListener();
  sockets[0]!.emit("message", JSON.stringify({ event_type: "last_trade_price", asset_id: "token-a", timestamp: "1767225900001", price: "0.54" }));

  assert.deepEqual(receivedTypes, ["price"]);
  await service.disconnect();
});

test("MarketStreamService reconnects and re-subscribes desired assets", async () => {
  const originalRandom = Math.random;
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
  const service = MarketStreamService.createDefault({ webSocketFactory });

  Math.random = () => 0;
  try {
    await service.connect({ reconnectDelayMs: 10 });
    service.subscribe({ assetIds: ["token-a"] });
    sockets[0]!.close();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(sockets.length >= 2, true);
  assert.equal(
    sockets.slice(1).some((socket) => socket.sentPayloads.some((payload) => payload.includes('"operation":"subscribe"') && payload.includes("token-a"))),
    true
  );
  await service.disconnect();
});

test("MarketStreamService applies jittered backoff when the market socket flaps", async () => {
  const originalRandom = Math.random;
  const sockets: FakeWebSocket[] = [];
  const sleepCalls: number[] = [];
  let now = 5_000;
  const clock: Clock = {
    now(): number {
      return now;
    },
    async sleep(milliseconds: number): Promise<void> {
      sleepCalls.push(milliseconds);
      if (milliseconds === config.WS_HEARTBEAT_INTERVAL_MS) {
        await new Promise<void>(() => {});
      }
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
  Math.random = () => 0;
  const service = MarketStreamService.createDefault({ webSocketFactory, clock });

  try {
    await service.connect({ reconnectDelayMs: 100 });
    now += 1_000;
    sockets[0]!.close();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    now += 1_000;
    sockets[1]!.close();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(sleepCalls.filter((milliseconds) => milliseconds !== config.WS_HEARTBEAT_INTERVAL_MS), [0, 50]);
  await service.disconnect();
});

test("MarketStreamService resets reconnect backoff after a stable session", async () => {
  const originalRandom = Math.random;
  const sockets: FakeWebSocket[] = [];
  const sleepCalls: number[] = [];
  let now = 10_000;
  const clock: Clock = {
    now(): number {
      return now;
    },
    async sleep(milliseconds: number): Promise<void> {
      sleepCalls.push(milliseconds);
      if (milliseconds === config.WS_HEARTBEAT_INTERVAL_MS) {
        await new Promise<void>(() => {});
      }
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
  Math.random = () => 0;
  const service = MarketStreamService.createDefault({ webSocketFactory, clock });

  try {
    await service.connect({ reconnectDelayMs: 100 });
    now += 31_000;
    sockets[0]!.close();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(sleepCalls.filter((milliseconds) => milliseconds !== config.WS_HEARTBEAT_INTERVAL_MS), [0]);
  await service.disconnect();
});

test("MarketStreamService sends PING heartbeat frames on open socket", async () => {
  const sockets: FakeWebSocket[] = [];
  const sleepCalls: number[] = [];
  const sleepResolvers: Array<() => void> = [];
  const clock: Clock = {
    now(): number {
      const now = Date.now();
      return now;
    },
    async sleep(milliseconds: number): Promise<void> {
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
  const service = MarketStreamService.createDefault({ webSocketFactory, clock });

  await service.connect();
  assert.equal(sleepCalls[0], config.WS_HEARTBEAT_INTERVAL_MS);
  sleepResolvers[0]!();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(sockets[0]!.sentPayloads.includes("PING"), true);
  await service.disconnect();
});

test("MarketStreamService stays connected for at least one heartbeat cycle without reconnecting", async () => {
  const sockets: FakeWebSocket[] = [];
  const sleepResolvers: Array<() => void> = [];
  let createCalls = 0;
  const clock: Clock = {
    now(): number {
      const now = Date.now();
      return now;
    },
    async sleep(): Promise<void> {
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
  const service = MarketStreamService.createDefault({ webSocketFactory, clock });

  await service.connect();
  sleepResolvers[0]!();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(createCalls, 1);
  await service.disconnect();
});
