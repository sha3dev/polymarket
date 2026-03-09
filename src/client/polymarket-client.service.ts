/**
 * @section imports:internals
 */

import { MarketCatalogService } from "../market/market-catalog.service.ts";
import { OrderService } from "../order/order.service.ts";
import { MarketStreamService } from "../stream/market-stream.service.ts";
import type { ConnectMarketStreamOptions } from "../stream/stream.types.ts";

/**
 * @section types
 */

type PolymarketClientOptions = {
  readonly markets?: MarketCatalogService;
  readonly stream?: MarketStreamService;
  readonly orders?: OrderService;
  readonly streamConnectOptions?: ConnectMarketStreamOptions;
};

export class PolymarketClient {
  /**
   * @section private:properties
   */

  private readonly streamConnectOptions: ConnectMarketStreamOptions | undefined;

  /**
   * @section public:properties
   */

  public readonly markets: MarketCatalogService;
  public readonly stream: MarketStreamService;
  public readonly orders: OrderService;

  /**
   * @section constructor
   */

  public constructor(options?: PolymarketClientOptions) {
    this.markets = options?.markets ?? MarketCatalogService.createDefault();
    this.stream = options?.stream ?? MarketStreamService.createDefault();
    this.orders = options?.orders ?? OrderService.createDefault();
    this.streamConnectOptions = options?.streamConnectOptions;
  }

  /**
   * @section factory
   */

  public static createDefault(options?: PolymarketClientOptions): PolymarketClient {
    const client = new PolymarketClient(options);
    return client;
  }

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
}
