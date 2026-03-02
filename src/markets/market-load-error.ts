/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { PolymarketError } from "../shared/polymarket-error.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

// empty

export class MarketLoadError extends PolymarketError {
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

  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "MarketLoadError";
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static forSlug(slug: string, reason: string): MarketLoadError {
    const error = new MarketLoadError(`Failed to load market for slug '${slug}': ${reason}`, { slug, reason });
    return error;
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

  // empty

  /**
   * @section static:methods
   */

  // empty
}
