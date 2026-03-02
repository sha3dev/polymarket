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

export class OrderClientInitializationError extends PolymarketError {
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
    this.name = "OrderClientInitializationError";
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static missingInitialization(): OrderClientInitializationError {
    const error = new OrderClientInitializationError("Order client is not initialized");
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
