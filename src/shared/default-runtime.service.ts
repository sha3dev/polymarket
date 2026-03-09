/**
 * @section imports:externals
 */

import Sha3Logger from "@sha3/logger";
import WebSocket from "ws";

/**
 * @section imports:internals
 */

import type { Clock, HttpClient, HttpResponse, Logger, WebSocketFactory, WebSocketLike } from "./shared-contract.types.ts";

/**
 * @section consts
 */

const DEFAULT_LOGGER_NAME = "polymarket";
const DEFAULT_LOGGER = new Sha3Logger({ loggerName: DEFAULT_LOGGER_NAME }) as unknown as Logger;

export class DefaultRuntimeService {
  /**
   * @section factory
   */

  public static create(): DefaultRuntimeService {
    const service = new DefaultRuntimeService();
    return service;
  }

  /**
   * @section public:methods
   */

  public createHttpClient(): HttpClient {
    const httpClient: HttpClient = {
      async fetch(url: string, init?: RequestInit): Promise<HttpResponse> {
        const response = (await fetch(url, init)) as unknown as HttpResponse;
        return response;
      }
    };
    return httpClient;
  }

  public createLogger(): Logger {
    const logger = DEFAULT_LOGGER;
    return logger;
  }

  public createClock(): Clock {
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

  public createWebSocketFactory(): WebSocketFactory {
    const webSocketFactory: WebSocketFactory = {
      create(url: string): WebSocketLike {
        const socket = new WebSocket(url) as unknown as WebSocketLike;
        return socket;
      }
    };
    return webSocketFactory;
  }
}
