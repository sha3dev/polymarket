import WebSocket from "ws";
import Sha3Logger from "@sha3/logger";

import type { Clock, HttpClient, HttpResponse, Logger, WebSocketFactory, WebSocketLike } from "./contracts.ts";

const DEFAULT_LOGGER_NAME = "polymarket";
const DEFAULT_LOGGER = new Sha3Logger({ loggerName: DEFAULT_LOGGER_NAME });

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
  const logger = DEFAULT_LOGGER;
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
