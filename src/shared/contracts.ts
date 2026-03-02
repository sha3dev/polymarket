export type HttpResponse = { ok: boolean; status: number; statusText: string; json(): Promise<unknown> };

export type HttpClient = { fetch(url: string, init?: RequestInit): Promise<HttpResponse> };

export type Logger = { debug(message: string): void; info(message: string): void; warn(message: string): void; error(message: string): void };

export type Clock = { now(): number; sleep(milliseconds: number): Promise<void> };

export type WebSocketLike = {
  readonly OPEN: number;
  readonly CLOSED: number;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): void;
};

export type WebSocketFactory = { create(url: string): WebSocketLike };
