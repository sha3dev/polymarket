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

export class OrderPlacementError extends PolymarketError {
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
    this.name = "OrderPlacementError";
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static unsafeAmount(amount: number): OrderPlacementError {
    const error = new OrderPlacementError(`Unsafe buy amount detected: ${amount}`, { amount });
    return error;
  }

  public static postFailed(reason: string): OrderPlacementError {
    const error = new OrderPlacementError(`Order posting failed: ${reason}`, { reason });
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
