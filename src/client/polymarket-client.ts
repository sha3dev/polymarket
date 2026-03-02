/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { GammaMarketCatalogService } from "../markets/gamma-market-catalog-service.ts";
import { MarketStreamService } from "../stream/market-stream-service.ts";
import { OrderService } from "../orders/order-service.ts";
import type { ConnectMarketStreamOptions } from "../stream/stream-types.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

type PolymarketClientOptions = {
  readonly markets?: GammaMarketCatalogService;
  readonly stream?: MarketStreamService;
  readonly orders?: OrderService;
  readonly streamConnectOptions?: ConnectMarketStreamOptions;
};

export class PolymarketClient {
  /**
   * @section private:attributes
   */

  // empty

  /**
   * @section protected:attributes
   */

  // empty

  /**
   * @section private:properties
   */

  private readonly streamConnectOptions: ConnectMarketStreamOptions | undefined;

  /**
   * @section public:properties
   */

  public readonly markets: GammaMarketCatalogService;
  public readonly stream: MarketStreamService;
  public readonly orders: OrderService;

  /**
   * @section constructor
   */

  public constructor(options?: PolymarketClientOptions) {
    this.markets = options?.markets ?? GammaMarketCatalogService.create();
    this.stream = options?.stream ?? MarketStreamService.create();
    this.orders = options?.orders ?? OrderService.create();
    this.streamConnectOptions = options?.streamConnectOptions;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(options?: PolymarketClientOptions): PolymarketClient {
    const client = new PolymarketClient(options);
    return client;
  }

  /**
   * @section private:methods
   */

  // empty

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async connect(): Promise<void> {
    await this.stream.connect(this.streamConnectOptions);
  }

  public async disconnect(): Promise<void> {
    await this.stream.disconnect();
    await this.orders.disconnect();
  }

  /**
   * @section static:methods
   */

  // empty
}

export type { PolymarketClientOptions };
