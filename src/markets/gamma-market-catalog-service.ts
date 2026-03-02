/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import { createDefaultHttpClient, createDefaultLogger } from "../shared/defaults.ts";
import type { HttpClient, Logger } from "../shared/contracts.ts";
import { MarketLoadError } from "./market-load-error.ts";
import { MarketNormalizer } from "./market-normalizer.ts";
import type {
  BuildCryptoWindowSlugsOptions,
  LoadCryptoWindowMarketsOptions,
  LoadMarketBySlugOptions,
  LoadMarketsBySlugsOptions,
  PolymarketMarket
} from "./market-types.ts";
import { CryptoWindowSlugBuilder } from "./crypto-window-slug-builder.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

type GammaMarketCatalogServiceOptions = {
  readonly httpClient?: HttpClient;
  readonly logger?: Logger;
  readonly normalizer?: MarketNormalizer;
  readonly slugBuilder?: CryptoWindowSlugBuilder;
};

export class GammaMarketCatalogService {
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

  private readonly httpClient: HttpClient;
  private readonly logger: Logger;
  private readonly normalizer: MarketNormalizer;
  private readonly slugBuilder: CryptoWindowSlugBuilder;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options?: GammaMarketCatalogServiceOptions) {
    this.httpClient = options?.httpClient ?? createDefaultHttpClient();
    this.logger = options?.logger ?? createDefaultLogger();
    this.normalizer = options?.normalizer ?? MarketNormalizer.create();
    this.slugBuilder = options?.slugBuilder ?? CryptoWindowSlugBuilder.create();
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(options?: GammaMarketCatalogServiceOptions): GammaMarketCatalogService {
    const service = new GammaMarketCatalogService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private buildMarketUrl(slug: string): string {
    const url = new URL(`/markets/slug/${slug}`, CONFIG.GAMMA_BASE_URL);
    const result = url.toString();
    return result;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async loadMarketBySlug(options: LoadMarketBySlugOptions): Promise<PolymarketMarket> {
    const url = this.buildMarketUrl(options.slug);
    this.logger.debug(`[MARKETS] Loading market slug=${options.slug} url=${url}`);
    const response = await this.httpClient.fetch(url, { method: "GET" });
    if (!response.ok) {
      throw MarketLoadError.forSlug(options.slug, `HTTP ${response.status} ${response.statusText}`);
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

  /**
   * @section static:methods
   */

  // empty
}
