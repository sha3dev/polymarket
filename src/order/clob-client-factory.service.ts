/**
 * @section imports:externals
 */

import { ClobClient } from "@polymarket/clob-client";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ClobApiKeyCreds, ClobClientFactoryCreateOptions, ClobClientLike } from "./order.types.ts";

export class ClobClientFactoryService {
  /**
   * @section factory
   */

  public static create(): ClobClientFactoryService {
    const service = new ClobClientFactoryService();
    return service;
  }

  /**
   * @section public:methods
   */

  public async createUnauthedClient(options: ClobClientFactoryCreateOptions): Promise<ClobClientLike> {
    const clobClientConstructor = ClobClient as unknown as new (...args: unknown[]) => ClobClientLike;
    const client = new clobClientConstructor(config.CLOB_BASE_URL, config.CLOB_CHAIN_ID, options.privateKey, undefined, options.signatureType, options.funderAddress);
    const clobClient = client as unknown as ClobClientLike;
    return clobClient;
  }

  public async createAuthedClient(
    options: ClobClientFactoryCreateOptions & { apiKeyCreds: ClobApiKeyCreds }
  ): Promise<ClobClientLike> {
    const clobClientConstructor = ClobClient as unknown as new (...args: unknown[]) => ClobClientLike;
    const client = new clobClientConstructor(config.CLOB_BASE_URL, config.CLOB_CHAIN_ID, options.privateKey, options.apiKeyCreds, options.signatureType, options.funderAddress);
    const clobClient = client as unknown as ClobClientLike;
    return clobClient;
  }
}
