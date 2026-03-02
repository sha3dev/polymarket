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

export class OrderConfirmationTimeoutError extends PolymarketError {
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
    this.name = "OrderConfirmationTimeoutError";
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static forOrder(orderId: string, timeoutMs: number): OrderConfirmationTimeoutError {
    const error = new OrderConfirmationTimeoutError(`Order confirmation timeout for '${orderId}' after ${timeoutMs}ms`, { orderId, timeoutMs });
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
