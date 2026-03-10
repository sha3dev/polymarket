# @sha3/polymarket

TypeScript library for automating Polymarket workflows from Node.js. The main use case is straightforward: load a market from Gamma, post an order to CLOB, and wait for the final confirmation state.

## TL;DR

```bash
npm install @sha3/polymarket
```

```ts
import { PolymarketClient } from "@sha3/polymarket";

const client = PolymarketClient.createDefault();
const market = await client.markets.loadMarketBySlug({ slug: "btc-updown-5m-1767225900" });

await client.orders.init({ privateKey: process.env.POLYMARKET_PRIVATE_KEY! });

const postedOrder = await client.orders.postOrder({
  market,
  op: "buy",
  direction: "up",
  executionType: "taker",
  size: 2,
  price: 0.52
});

const confirmation = await client.orders.waitForOrderConfirmation({ order: postedOrder! });

console.log(postedOrder?.id, confirmation.status);
```

## Why

- Combines market discovery, market streaming, and order execution in one package.
- Exposes direct services (`markets`, `stream`, `orders`) instead of hiding behavior behind unnecessary wrappers.
- Keeps runtime dependencies injectable so websocket, clock, and order-client flows can be tested deterministically.

## Installation

```bash
npm install @sha3/polymarket
```

## Usage

```ts
import { MarketCatalogService, OrderService } from "@sha3/polymarket";

const marketCatalogService = MarketCatalogService.createDefault();
const orderService = OrderService.createDefault();

const market = await marketCatalogService.loadMarketBySlug({ slug: "btc-updown-5m-1767225900" });
const priceToBeat = await marketCatalogService.getPriceToBeat({ market });
await orderService.init({ privateKey: process.env.POLYMARKET_PRIVATE_KEY! });

const postedOrder = await orderService.postOrder({
  market,
  op: "buy",
  direction: "up",
  executionType: "taker",
  size: 2,
  price: 0.52
});

const confirmation = await orderService.waitForOrderConfirmation({ order: postedOrder! });

console.log(priceToBeat, confirmation.status);
```

## Examples

Post a taker order and wait for confirmation:

```ts
import { MarketCatalogService, OrderService } from "@sha3/polymarket";

const marketCatalogService = MarketCatalogService.createDefault();
const orderService = OrderService.createDefault();

const market = await marketCatalogService.loadMarketBySlug({ slug: "btc-updown-5m-1767225900" });
const priceToBeat = await marketCatalogService.getPriceToBeat({ market });
await orderService.init({ privateKey: process.env.POLYMARKET_PRIVATE_KEY! });

const postedOrder = await orderService.postOrder({
  market,
  op: "buy",
  direction: "up",
  executionType: "taker",
  size: 2,
  price: 0.52
});

const confirmation = await orderService.waitForOrderConfirmation({
  order: postedOrder!,
  timeoutMs: 15_000
});

console.log(priceToBeat, confirmation.status);
```

Load multiple time-window markets:

```ts
import { MarketCatalogService } from "@sha3/polymarket";

const marketCatalogService = MarketCatalogService.createDefault();
const slugs = marketCatalogService.buildCryptoWindowSlugs({
  date: new Date("2026-01-01T00:07:33.000Z"),
  window: "5m",
  symbols: ["btc", "eth"]
});

const markets = await marketCatalogService.loadMarketsBySlugs({ slugs });
```

Load the market price to beat:

```ts
import { MarketCatalogService } from "@sha3/polymarket";

const marketCatalogService = MarketCatalogService.createDefault();
const market = await marketCatalogService.loadMarketBySlug({ slug: "btc-updown-5m-1767225900" });
const priceToBeat = await marketCatalogService.getPriceToBeat({ market });
```

Subscribe to prices and order books:

```ts
import { MarketStreamService } from "@sha3/polymarket";

const marketStreamService = MarketStreamService.createDefault();

await marketStreamService.connect();
marketStreamService.subscribe({ assetIds: ["token-a"] });
marketStreamService.addListener({
  listener(event): void {
    console.log(event.type, event.assetId);
  }
});
```

## Public API

### `PolymarketClient`

Root client that composes `MarketCatalogService`, `MarketStreamService`, and `OrderService`.

#### `createDefault()`

Creates a ready-to-use client with default runtime wiring.

#### `connect()`

Opens the market stream connection.

#### `disconnect()`

Closes the market stream and the order user stream.

### `OrderService`

Primary trading service. If the goal is to place orders, this is the main API surface.

#### `createDefault()`

Creates the order service with default runtime wiring.

#### `init()`

Derives API credentials from the private key, builds the authenticated client, and opens the user websocket.

#### `getMyBalance()`

Reads the available collateral balance.

#### `postOrder()`

Posts a `paper`, `maker`, or `taker` order depending on the provided options.

Behavior notes:
- `executionType: "taker"` adjusts price by slippage.
- `executionType: "maker"` uses expiration and normalized size.
- `paperMode: true` avoids live posting and simulates confirmation.
- taker sells cancel opposite-side orders before posting.

#### `waitForOrderConfirmation()`

Waits for final status from the user websocket or from reconnect/timeout rechecks.

Behavior notes:
- returns `confirmed`, `cancelled`, or `failed`
- can cancel on timeout when `shouldCancelOnTimeout` remains enabled
- includes `latency` and optional `error` in the final result

### `InitializeOrderServiceOptions`

Options for initializing the order service.

### `PostOrderOptions`

Input payload for posting an order.

### `PostedOrder`

Posted order record with `id` and `date`.

### `PostedOrderWithStatus`

Posted order plus final status, latency, and optional error.

### `Direction`

Outcome direction: `"up"` or `"down"`.

### `Operation`

Order side intent: `"buy"` or `"sell"`.

### `ExecutionType`

Execution mode: `"maker"` or `"taker"`.

### `OrderStatus`

Final order status: `"confirmed"`, `"cancelled"`, or `"failed"`.

### `WaitForOrderConfirmationOptions`

Options for waiting on final confirmation.

### `MarketCatalogService`

Service for loading and normalizing Gamma market payloads.

#### `createDefault()`

Creates the catalog with default `fetch` and logger wiring.

#### `buildMarketUrl()`

Builds the internal Gamma URL used to resolve one slug.

#### `loadMarketBySlug()`

Loads one market and normalizes outcomes, token ids, dates, and numeric fields.

#### `loadMarketsBySlugs()`

Loads multiple slugs sequentially and preserves input order.

#### `getPriceToBeat()`

Loads the market `priceToBeat` from Polymarket's crypto price endpoint using the normalized market symbol, start time, end time, and time-window variant.

#### `buildCryptoWindowSlugs()`

Builds UTC-aligned `5m` and `15m` crypto market slugs.

#### `loadCryptoWindowMarkets()`

Composes `buildCryptoWindowSlugs()` and `loadMarketsBySlugs()`.

### `BuildCryptoWindowSlugsOptions`

Options for building aligned market slugs.

### `GetPriceToBeatOptions`

Options for loading `priceToBeat` for one normalized market.

### `CryptoMarketWindow`

Supported crypto market window values.

### `CryptoSymbol`

Supported default crypto symbols.

### `LoadCryptoWindowMarketsOptions`

Options for loading markets by aligned window.

### `LoadMarketBySlugOptions`

Options for loading one market by slug.

### `LoadMarketsBySlugsOptions`

Options for loading multiple markets by slug.

### `OrderBook`

Normalized order book.

### `OrderBookLevel`

Single price and size level.

### `PolymarketMarket`

Normalized market shape used by orders and stream handling.

### `MarketStreamService`

Service for maintaining the market websocket, subscriptions, and local cache.

#### `createDefault()`

Creates the stream service with default websocket, logger, and clock wiring.

#### `connect()`

Opens the market websocket.

#### `disconnect()`

Closes the websocket and stops heartbeat processing.

#### `subscribe()`

Subscribes asset ids.

#### `unsubscribe()`

Unsubscribes asset ids.

#### `addListener()`

Registers a parsed market event listener.

#### `getAssetPrice()`

Returns the latest cached price for one asset.

#### `getAssetOrderBook()`

Returns the latest cached order book for one asset.

#### `getEndpointUrl()`

Resolves the internal market websocket endpoint.

#### `bindSocket()`

Attaches internal handlers to a socket instance.

#### `onOpen()`

Resets active subscriptions and starts heartbeat on socket open.

#### `onClose()`

Handles reconnect and subscription replay.

#### `onError()`

Reports websocket failures.

#### `onMessage()`

Parses messages and updates local caches.

#### `createSubscriptionPayload()`

Serializes subscribe and unsubscribe payloads.

#### `sendPayload()`

Sends payloads to the open websocket.

#### `flushSubscriptions()`

Replays pending subscriptions after connect or reconnect.

#### `openSocket()`

Opens the live market websocket.

#### `startHeartbeatLoop()`

Starts heartbeat processing.

#### `stopHeartbeatLoop()`

Stops heartbeat processing.

#### `runHeartbeatLoop()`

Internal heartbeat loop.

#### `sendPing()`

Sends `PING` to the market websocket.

### `AddMarketListenerOptions`

Options for registering stream listeners.

### `ConnectMarketStreamOptions`

Options for market stream connection behavior.

### `GetAssetOrderBookOptions`

Options for reading one cached order book.

### `GetAssetPriceOptions`

Options for reading one cached price.

### `MarketBookEvent`

Normalized book event.

### `MarketEvent`

Union of supported market events.

### `MarketPriceEvent`

Normalized price event.

### `SubscribeMarketAssetsOptions`

Options for subscribing asset ids.

### `UnsubscribeMarketAssetsOptions`

Options for unsubscribing asset ids.

### `PackageInfoService`

Scaffold compatibility service.

#### `createDefault()`

Creates the default package info service.

#### `readPackageInfo()`

Returns the configured package name.

### `PackageInfo`

`type PackageInfo = { packageName: string }`

## Compatibility

- Node.js 20+
- ESM
- TypeScript with relative `.ts` imports enabled

## Configuration

- `config.PACKAGE_NAME`: package name.
- `config.DEFAULT_CRYPTO_SYMBOLS`: default symbols for slug building.
- `config.GAMMA_BASE_URL`: Gamma base URL.
- `config.PRICE_TO_BEAT_API_BASE_URL`: Polymarket crypto price endpoint used for `getPriceToBeat()`.
- `config.CLOB_BASE_URL`: CLOB base URL.
- `config.CLOB_CHAIN_ID`: chain id used by the trading client.
- `config.WS_BASE_URL`: websocket base URL.
- `config.MARKET_WS_PATH`: market websocket path.
- `config.USER_WS_PATH`: user websocket path.
- `config.WS_HEARTBEAT_INTERVAL_MS`: heartbeat interval.
- `config.DEFAULT_RECONNECT_DELAY_MS`: base reconnect delay.
- `config.DEFAULT_RECONNECT_JITTER_MIN_FACTOR`: reserved lower jitter factor.
- `config.DEFAULT_RECONNECT_JITTER_MAX_FACTOR`: reserved upper jitter factor.
- `config.DEFAULT_ORDER_CONFIRMATION_TIMEOUT_MS`: default confirmation timeout.
- `config.DEFAULT_PAPER_MODE_DELAY_MS`: paper-mode delay.
- `config.DEFAULT_ORDER_EXPIRATION_MS`: default maker-order expiration window.
- `config.DEFAULT_ORDER_TICK_SIZE`: fallback tick size.
- `config.ORDER_PRICE_DECIMALS`: price precision.
- `config.ORDER_SIZE_DECIMALS`: size precision.
- `config.ORDER_AMOUNT_DECIMALS`: taker amount precision.
- `config.MAX_PRICE`: maximum allowed price.
- `config.SAFE_MAX_BUY_AMOUNT`: guardrail for taker buys.
- `config.DEFAULT_MAX_ALLOWED_SLIPPAGE`: default slippage adjustment for taker orders.

## Scripts

- `npm run standards:check`: verifies project contract rules.
- `npm run lint`: runs Biome.
- `npm run format:check`: validates formatting.
- `npm run typecheck`: runs `tsc --noEmit`.
- `npm run test`: runs the `node:test` suite.
- `npm run check`: runs standards, lint, format, typecheck, and tests.
- `npm run build`: builds `dist/`.

## Structure

- `src/client/`: root client.
- `src/market/`: catalog, slug builder, and market normalization.
- `src/order/`: initialization, posting, and confirmation flows.
- `src/stream/`: market websocket and event parsing.
- `src/shared/`: runtime contracts and default wiring.
- `src/package-info/`: scaffold compatibility surface.
- `test/`: observable behavior tests.

## Troubleshooting

### Orders do not confirm

Check that `init()` ran before `postOrder()`, that the private key is valid, and that the user websocket can connect.

### `postOrder()` fails in taker mode

Verify `size`, `price`, `direction`, `op`, and that the computed amount does not exceed `config.SAFE_MAX_BUY_AMOUNT`.

### `npm run standards:check` fails even when the code works

The working tree already contains drift in managed files such as `AGENTS.md`, `ai/*`, and `.vscode/*`. That can keep standards verification red even when `src/` and `test/` are correct.

## AI Workflow

- Read `AGENTS.md`, `ai/contract.json`, and the assistant adapter before changing code.
- Do not edit managed files unless the task is an explicit standards update.
- Prefer the current scaffold shape over the legacy project structure.
- Run `npm run check` before finalizing implementation work.
