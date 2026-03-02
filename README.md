# @sha3/polymarket

TypeScript library for Polymarket automation in Node.js: load markets from Gamma, stream CLOB market events, post orders, and confirm order lifecycle through the user websocket.

## TL;DR (60s Quick Start)

```bash
npm install @sha3/polymarket
```

```ts
import { PolymarketClient } from "@sha3/polymarket";

const client = new PolymarketClient();

const market = await client.markets.loadMarketBySlug({ slug: "btc-updown-5m-1767225900" });

await client.orders.init({ privateKey: process.env.POLYMARKET_PRIVATE_KEY!, funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS });

const posted = await client.orders.postOrder({ market, op: "buy", direction: "up", executionType: "taker", size: 2, price: 0.52 });

const confirmed = await client.orders.waitForOrderConfirmation({ order: posted });
console.log(confirmed.status);
```

## Why This Library Exists

- Unifies Gamma (market metadata) and CLOB (execution) in one strongly-typed API.
- Encapsulates websocket lifecycle (subscribe, reconnect, cache updates).
- Encapsulates order lifecycle (post, wait, timeout recheck, safe cancel).
- Provides deterministic constructor-injection points for testing.

## Installation

```bash
npm install @sha3/polymarket
```

## Compatibility

- Runtime: Node.js 20+
- Module system: ESM (`"type": "module"`)
- Language: TypeScript (strict mode)
- Browser support: not in v1

## Public API Reference

### Core facade

- `PolymarketClient`
- `new PolymarketClient(options?)`
- `client.markets: GammaMarketCatalogService`
- `client.stream: MarketStreamService`
- `client.orders: OrderService`
- `await client.connect()` (connects market stream)
- `await client.disconnect()` (disconnects stream and order ws)

### Markets API

- `GammaMarketCatalogService`
- `loadMarketBySlug(options): Promise<PolymarketMarket>`
- `loadMarketsBySlugs(options): Promise<PolymarketMarket[]>`
- `buildCryptoWindowSlugs(options): string[]`
- `loadCryptoWindowMarkets(options): Promise<PolymarketMarket[]>`

#### Example

```ts
import { GammaMarketCatalogService } from "@sha3/polymarket";

const markets = GammaMarketCatalogService.create();
const slugs = markets.buildCryptoWindowSlugs({ date: new Date(), window: "5m", symbols: ["btc", "eth"] });
const loaded = await markets.loadMarketsBySlugs({ slugs });
```

### Stream API

- `MarketStreamService`
- `connect(options?): Promise<void>`
- `disconnect(): Promise<void>`
- `subscribe(options): void`
- `unsubscribe(options): void`
- `addListener(options): () => void`
- `getAssetPrice(options): number | null`
- `getAssetOrderBook(options): OrderBook | null`

#### Example

```ts
import { MarketStreamService } from "@sha3/polymarket";

const stream = MarketStreamService.create();
await stream.connect();
stream.subscribe({ assetIds: ["123", "456"] });

const remove = stream.addListener({
  listener: (event) => {
    if (event.type === "price") {
      console.log(event.assetId, event.price);
    }
  }
});

// later
remove();
await stream.disconnect();
```

### Orders API

- `OrderService`
- `init(options): Promise<void>`
- `postOrder(options): Promise<PostedOrder | null>`
- `waitForOrderConfirmation(options): Promise<PostedOrderWithStatus>`
- `getMyBalance(): Promise<number>`
- `disconnect(): Promise<void>`

#### Example

```ts
import { OrderService } from "@sha3/polymarket";

const orders = OrderService.create();
await orders.init({ privateKey: process.env.POLYMARKET_PRIVATE_KEY!, funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS, maxAllowedSlippage: 0.02 });

const posted = await orders.postOrder({ market, op: "sell", direction: "down", executionType: "maker", size: 1, price: 0.48 });

const result = await orders.waitForOrderConfirmation({ order: posted, timeoutMs: 30_000, cancelOnTimeout: true });
```

## Exported Types

- Markets: `PolymarketMarket`, `CryptoMarketWindow`, `CryptoSymbol`, `OrderBook`
- Stream: `MarketEvent`, `MarketPriceEvent`, `MarketBookEvent`
- Orders: `Direction`, `Operation`, `ExecutionType`, `OrderStatus`, `PostedOrder`, `PostedOrderWithStatus`

## Typed Errors

- `PolymarketError`
- `MarketLoadError`
- `MarketNormalizationError`
- `MarketStreamConnectionError`
- `MarketStreamProtocolError`
- `OrderClientInitializationError`
- `OrderPlacementError`
- `OrderConfirmationTimeoutError`
- `OrderConfirmationFailedError`

## Integration Guide (External Projects)

1. Install package in your service.
2. Import only from `@sha3/polymarket`.
3. Initialize `OrderService` once per process with your key material.
4. Keep `MarketStreamService` connected for live cache and event listeners.
5. Handle typed errors by class (`instanceof`).

## Configuration Reference (`src/config.ts`)

`src/config.ts` exports one default `CONFIG` object with hardcoded library defaults:

- `GAMMA_BASE_URL`: Gamma REST endpoint.
- `CLOB_BASE_URL`: CLOB REST endpoint.
- `CLOB_CHAIN_ID`: chain ID used by CLOB client.
- `WS_BASE_URL`: websocket base endpoint.
- `MARKET_WS_PATH`: market channel path.
- `USER_WS_PATH`: user channel path.
- `DEFAULT_RECONNECT_DELAY_MS`: reconnect backoff delay.
- `DEFAULT_ORDER_CONFIRMATION_TIMEOUT_MS`: default confirmation timeout.
- `DEFAULT_PAPER_MODE_DELAY_MS`: fake latency for paper mode.
- `DEFAULT_ORDER_EXPIRATION_MS`: default maker order expiration.
- `DEFAULT_ORDER_TICK_SIZE`: fallback tick size.
- `ORDER_PRICE_DECIMALS`, `ORDER_SIZE_DECIMALS`, `ORDER_AMOUNT_DECIMALS`: rounding controls.
- `MAX_PRICE`: upper bound for normalized price.
- `SAFE_MAX_BUY_AMOUNT`: guardrail for market buy amount.
- `DEFAULT_MAX_ALLOWED_SLIPPAGE`: fallback slippage used in taker orders.

Runtime credentials are not hardcoded and must be injected through `OrderService.init`.

## Development

```bash
npm install
npm run check
npm run build
```

## AI Usage

If you use coding assistants in this repository:

- Treat `AGENTS.md` as blocking and authoritative.
- Keep class-first structure and required `@section` blocks.
- Keep single-return policy in functions/methods.
- Add/update tests for any behavior change.
- Run `npm run check` before finalizing.
