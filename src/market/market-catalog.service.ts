/**
 * @section imports:internals
 */

import config from "../config.ts";
import { DefaultRuntimeService } from "../shared/default-runtime.service.ts";
import type { HttpClient, Logger } from "../shared/shared-contract.types.ts";
import type {
  BuildCryptoWindowSlugsOptions,
  GetPriceToBeatOptions,
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

  private readWindowVariant(market: PolymarketMarket): "fiveminute" | "fifteen" {
    const hasFifteenMinuteWindow = market.slug.includes("-15m-");
    const windowVariant = hasFifteenMinuteWindow ? "fifteen" : "fiveminute";
    return windowVariant;
  }

  private buildPriceToBeatUrl(market: PolymarketMarket): string {
    if (market.symbol === null) {
      throw new Error(`Failed to build price-to-beat URL for market '${market.slug}': symbol is not available.`);
    }
    const params = new URLSearchParams({
      symbol: market.symbol.toUpperCase(),
      eventStartTime: market.start.toISOString(),
      variant: this.readWindowVariant(market),
      endDate: market.end.toISOString()
    });
    const priceToBeatUrl = `${config.PRICE_TO_BEAT_API_BASE_URL}?${params.toString()}`;
    return priceToBeatUrl;
  }

  private parsePriceToBeat(payload: unknown): number | null {
    const openPrice = typeof payload === "object" && payload !== null && "openPrice" in payload ? (payload as { openPrice?: unknown }).openPrice : null;
    const priceToBeat = typeof openPrice === "number" && Number.isFinite(openPrice) ? openPrice : null;
    return priceToBeat;
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

  public async getPriceToBeat(options: GetPriceToBeatOptions): Promise<number | null> {
    const priceToBeatUrl = this.buildPriceToBeatUrl(options.market);
    this.logger.debug(`[MARKET] Loading priceToBeat slug=${options.market.slug} url=${priceToBeatUrl}`);
    const response = await this.httpClient.fetch(priceToBeatUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to load priceToBeat for market '${options.market.slug}': HTTP ${response.status} ${response.statusText}.`);
    }
    const payload = await response.json();
    const priceToBeat = this.parsePriceToBeat(payload);
    return priceToBeat;
  }
}
