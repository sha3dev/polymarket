import WebSocket from "ws";

import type { Clock, HttpClient, HttpResponse, Logger, WebSocketFactory, WebSocketLike } from "./contracts.ts";

export function createDefaultHttpClient(): HttpClient {
  const client: HttpClient = {
    async fetch(url: string, init?: RequestInit): Promise<HttpResponse> {
      const response = await fetch(url, init);
      const casted = response as unknown as HttpResponse;
      return casted;
    }
  };
  return client;
}

export function createDefaultLogger(): Logger {
  const logger: Logger = {
    debug(message: string): void {
      console.debug(message);
    },
    info(message: string): void {
      console.info(message);
    },
    warn(message: string): void {
      console.warn(message);
    },
    error(message: string): void {
      console.error(message);
    }
  };
  return logger;
}

export function createDefaultClock(): Clock {
  const clock: Clock = {
    now(): number {
      const now = Date.now();
      return now;
    },
    async sleep(milliseconds: number): Promise<void> {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, milliseconds));
      });
    }
  };
  return clock;
}

export function createDefaultWebSocketFactory(): WebSocketFactory {
  const factory: WebSocketFactory = {
    create(url: string): WebSocketLike {
      const socket = new WebSocket(url) as unknown as WebSocketLike;
      return socket;
    }
  };
  return factory;
}
