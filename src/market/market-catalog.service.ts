/**
 * @section imports:internals
 */

import config from "../config.ts";
import { DefaultRuntimeService } from "../shared/default-runtime.service.ts";
import type { HttpClient, Logger } from "../shared/shared-contract.types.ts";
import type {
  BuildCryptoWindowSlugsOptions,
  LoadCryptoWindowMarketsOptions,
  LoadMarketBySlugOptions,
  LoadMarketsBySlugsOptions,
  PolymarketMarket
} from "./market.types.ts";
import { CryptoWindowSlugBuilderService } from "./crypto-window-slug-builder.service.ts";
import { MarketNormalizerService } from "./market-normalizer.service.ts";

/**
 * @section types
 */

type MarketCatalogServiceOptions = {
  readonly httpClient?: HttpClient;
  readonly logger?: Logger;
  readonly normalizer?: MarketNormalizerService;
  readonly slugBuilder?: CryptoWindowSlugBuilderService;
};

export class MarketCatalogService {
  /**
   * @section private:properties
   */

  private readonly httpClient: HttpClient;
  private readonly logger: Logger;
  private readonly normalizer: MarketNormalizerService;
  private readonly slugBuilder: CryptoWindowSlugBuilderService;

  /**
   * @section constructor
   */

  public constructor(options?: MarketCatalogServiceOptions) {
    const defaultRuntimeService = DefaultRuntimeService.create();
    this.httpClient = options?.httpClient ?? defaultRuntimeService.createHttpClient();
    this.logger = options?.logger ?? defaultRuntimeService.createLogger();
    this.normalizer = options?.normalizer ?? MarketNormalizerService.create();
    this.slugBuilder = options?.slugBuilder ?? CryptoWindowSlugBuilderService.create();
  }

  /**
   * @section factory
   */

  public static createDefault(): MarketCatalogService {
    const service = new MarketCatalogService();
    return service;
  }

  /**
   * @section private:methods
   */

  private buildMarketUrl(slug: string): string {
    const marketUrl = new URL(`/markets/slug/${slug}`, config.GAMMA_BASE_URL).toString();
    return marketUrl;
  }

  /**
   * @section public:methods
   */

  public async loadMarketBySlug(options: LoadMarketBySlugOptions): Promise<PolymarketMarket> {
    const marketUrl = this.buildMarketUrl(options.slug);
    this.logger.debug(`[MARKET] Loading market slug=${options.slug} url=${marketUrl}`);
    const response = await this.httpClient.fetch(marketUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to load market '${options.slug}': HTTP ${response.status} ${response.statusText}.`);
    }
    const payload = await response.json();
    const market = this.normalizer.normalize(payload);
    return market;
  }

  public async loadMarketsBySlugs(options: LoadMarketsBySlugsOptions): Promise<PolymarketMarket[]> {
    const markets: PolymarketMarket[] = [];
    for (const slug of options.slugs) {
      const market = await this.loadMarketBySlug({ slug });
      markets.push(market);
    }
    return markets;
  }

  public buildCryptoWindowSlugs(options: BuildCryptoWindowSlugsOptions): string[] {
    const slugs = this.slugBuilder.build(options);
    return slugs;
  }

  public async loadCryptoWindowMarkets(options: LoadCryptoWindowMarketsOptions): Promise<PolymarketMarket[]> {
    const slugs = this.buildCryptoWindowSlugs(options);
    const markets = await this.loadMarketsBySlugs({ slugs });
    return markets;
  }
}
