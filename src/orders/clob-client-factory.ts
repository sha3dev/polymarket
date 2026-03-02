/**
 * @section imports:externals
 */

import { Wallet } from "@ethersproject/wallet";
import { ClobClient } from "@polymarket/clob-client";
import type { SignatureType } from "@polymarket/order-utils";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import type { ClobClientFactoryCreateOptions, ClobClientLike, ClobApiKeyCreds } from "./order-types.ts";

/**
 * @section consts
 */

const DEFAULT_SIGNATURE_TYPE: SignatureType = 1;

/**
 * @section types
 */

// empty

export class PolymarketClobClientFactory {
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

  public static create(): PolymarketClobClientFactory {
    const factory = new PolymarketClobClientFactory();
    return factory;
  }

  /**
   * @section private:methods
   */

  private createSigner(privateKey: string): Wallet {
    const signer = new Wallet(privateKey);
    return signer;
  }

  private resolveSignatureType(signatureType?: SignatureType): SignatureType {
    const resolved = signatureType ?? DEFAULT_SIGNATURE_TYPE;
    return resolved;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async createUnauthedClient(options: ClobClientFactoryCreateOptions): Promise<ClobClientLike> {
    const signer = this.createSigner(options.privateKey);
    const client = new ClobClient(CONFIG.CLOB_BASE_URL, CONFIG.CLOB_CHAIN_ID, signer);
    return client as unknown as ClobClientLike;
  }

  public async createAuthedClient(options: ClobClientFactoryCreateOptions & { apiKeyCreds: ClobApiKeyCreds }): Promise<ClobClientLike> {
    const signer = this.createSigner(options.privateKey);
    const signatureType = this.resolveSignatureType(options.signatureType);
    const client = new ClobClient(CONFIG.CLOB_BASE_URL, CONFIG.CLOB_CHAIN_ID, signer, options.apiKeyCreds, signatureType, options.funderAddress);
    return client as unknown as ClobClientLike;
  }

  /**
   * @section static:methods
   */

  // empty
}
