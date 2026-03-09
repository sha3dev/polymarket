/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { BuildCryptoWindowSlugsOptions, CryptoSymbol } from "./market.types.ts";

export class CryptoWindowSlugBuilderService {
  /**
   * @section factory
   */

  public static create(): CryptoWindowSlugBuilderService {
    const service = new CryptoWindowSlugBuilderService();
    return service;
  }

  /**
   * @section public:methods
   */

  public build(options: BuildCryptoWindowSlugsOptions): string[] {
    const selectedSymbols: CryptoSymbol[] = options.symbols ?? [...config.DEFAULT_CRYPTO_SYMBOLS];
    const windowMinutes = options.window === "5m" ? 5 : 15;
    const windowMilliseconds = windowMinutes * 60 * 1000;
    const windowTimestamp = Math.floor(options.date.getTime() / windowMilliseconds) * windowMilliseconds;
    const windowSeconds = Math.floor(windowTimestamp / 1000);
    const slugs = selectedSymbols.map((symbol) => `${symbol}-updown-${options.window}-${windowSeconds}`);
    return slugs;
  }
}
