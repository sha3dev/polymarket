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

export class OrderConfirmationFailedError extends PolymarketError {
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
    this.name = "OrderConfirmationFailedError";
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static forOrder(orderId: string, reason: string): OrderConfirmationFailedError {
    const error = new OrderConfirmationFailedError(`Order '${orderId}' failed confirmation: ${reason}`, { orderId, reason });
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
