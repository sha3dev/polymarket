/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import type { BuildCryptoWindowSlugsOptions, CryptoMarketWindow } from "./market-types.ts";
import CONFIG from "../config.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

// empty

export class CryptoWindowSlugBuilder {
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

  // empty

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor() {
    // empty
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): CryptoWindowSlugBuilder {
    const builder = new CryptoWindowSlugBuilder();
    return builder;
  }

  /**
   * @section private:methods
   */

  private getWindowMinutes(window: CryptoMarketWindow): number {
    const minutes = window === "15m" ? 15 : 5;
    return minutes;
  }

  private computeWindowTimestamp(date: Date, window: CryptoMarketWindow): number {
    const windowMinutes = this.getWindowMinutes(window);
    const currentMinute = date.getUTCMinutes();
    const windowStartMinute = Math.floor(currentMinute / windowMinutes) * windowMinutes;
    const windowStartDate = new Date(date.getTime());
    windowStartDate.setUTCMinutes(windowStartMinute);
    windowStartDate.setUTCSeconds(0);
    windowStartDate.setUTCMilliseconds(0);
    const timestamp = Math.floor(windowStartDate.getTime() / 1000);
    return timestamp;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public build(options: BuildCryptoWindowSlugsOptions): string[] {
    const symbols = options.symbols ?? [...CONFIG.DEFAULT_CRYPTO_SYMBOLS];
    const timestamp = this.computeWindowTimestamp(options.date, options.window);
    const slugs = symbols.map((symbol) => {
      return `${symbol}-updown-${options.window}-${timestamp}`;
    });
    return slugs;
  }

  /**
   * @section static:methods
   */

  // empty
}
