import type { SignatureType } from "@polymarket/order-utils";

import type { PolymarketMarket } from "../markets/market-types.ts";
import type { WebSocketLike } from "../shared/contracts.ts";

export type Direction = "up" | "down";

export type Operation = "buy" | "sell";

export type ExecutionType = "maker" | "taker";

export type OrderStatus = "confirmed" | "cancelled" | "failed";

export type InitializeOrderServiceOptions = {
  readonly privateKey: string;
  readonly funderAddress?: string;
  readonly signatureType?: SignatureType;
  readonly maxAllowedSlippage?: number;
};

export type PostOrderOptions = {
  readonly market: PolymarketMarket;
  readonly size: number;
  readonly price: number;
  readonly op: Operation;
  readonly direction: Direction;
  readonly executionType?: ExecutionType;
  readonly paperMode?: boolean;
};

export type PostedOrder = PostOrderOptions & { readonly id: string; readonly date: Date };

export type WaitForOrderConfirmationOptions = { readonly order: PostedOrder; readonly timeoutMs?: number; readonly cancelOnTimeout?: boolean };

export type PostedOrderWithStatus = PostedOrder & { readonly ok: boolean; readonly status: OrderStatus; readonly latency: number; readonly error?: Error };

export type OrderMessage = { readonly id: string; readonly status: OrderStatus };

export type ClobApiKeyCreds = { key: string; secret: string; passphrase: string };

export type ClobPostResponse = { success?: boolean; orderID?: string; status?: string; errorMsg?: string; error?: unknown };

export type BalanceAllowance = { balance?: string };

export type TradeInfo = { status: string; taker_order_id?: string; maker_orders?: { order_id: string }[] };

export type CancelOrderResponse = { cancelled?: string[] };

export type ClobClientLike = {
  deriveApiKey(): Promise<ClobApiKeyCreds>;
  getBalanceAllowance(input: Record<string, unknown>): Promise<BalanceAllowance>;
  updateBalanceAllowance(input: Record<string, unknown>): Promise<void>;
  cancelOrder(input: { orderID: string }): Promise<CancelOrderResponse>;
  cancelMarketOrders(input: { market: string; asset_id: string }): Promise<CancelOrderResponse>;
  createAndPostOrder<TOrderType>(order: Record<string, unknown>, options: { tickSize: string }, orderType: TOrderType): Promise<ClobPostResponse>;
  createAndPostMarketOrder<TOrderType>(order: Record<string, unknown>, options: { tickSize: string }, orderType: TOrderType): Promise<ClobPostResponse>;
  getTrades(): Promise<TradeInfo[]>;
};

export type ClobClientFactoryCreateOptions = { readonly privateKey: string; readonly funderAddress?: string; readonly signatureType?: SignatureType };

export type ClobClientFactory = {
  createUnauthedClient(options: ClobClientFactoryCreateOptions): Promise<ClobClientLike>;
  createAuthedClient(options: ClobClientFactoryCreateOptions & { apiKeyCreds: ClobApiKeyCreds }): Promise<ClobClientLike>;
};

export type UserStreamAuthPayload = { apiKey: string; secret: string; passphrase: string };

export type UserStreamMessage = {
  event_type?: string;
  type?: string;
  status?: string;
  id?: string;
  taker_order_id?: string;
  maker_orders?: { order_id: string }[];
};

export type OrderServiceReconnectListener = () => Promise<void>;

export type OrderServiceSocketState = { ws: WebSocketLike | null };
