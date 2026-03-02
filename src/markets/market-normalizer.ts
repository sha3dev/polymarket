/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { isRecord } from "../shared/utils.ts";
import CONFIG from "../config.ts";
import { MarketNormalizationError } from "./market-normalization-error.ts";
import type { CryptoSymbol, PolymarketMarket } from "./market-types.ts";

/**
 * @section consts
 */

const KNOWN_SYMBOLS: readonly CryptoSymbol[] = CONFIG.DEFAULT_CRYPTO_SYMBOLS;

/**
 * @section types
 */

// empty

export class MarketNormalizer {
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

  public static create(): MarketNormalizer {
    const normalizer = new MarketNormalizer();
    return normalizer;
  }

  /**
   * @section private:methods
   */

  private parseStringArray(value: unknown): string[] {
    let result: string[] = [];
    if (Array.isArray(value)) {
      result = value.filter((item) => {
        return typeof item === "string";
      });
    } else if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          result = parsed.filter((item) => {
            return typeof item === "string";
          });
        }
      } catch {
        result = [];
      }
    }
    return result;
  }

  private findTokenIdForOutcome(outcomes: string[], clobTokenIds: string[], outcomeName: string): string {
    const normalizedOutcome = outcomeName.toLowerCase();
    const index = outcomes.findIndex((outcome) => {
      return outcome.toLowerCase() === normalizedOutcome;
    });
    let tokenId = "";
    if (index >= 0) {
      tokenId = clobTokenIds[index] ?? "";
    }
    return tokenId;
  }

  private parseSymbol(slug: string): CryptoSymbol | null {
    const candidate = slug.split("-")[0] ?? "";
    const normalized = candidate.toLowerCase();
    const symbol = KNOWN_SYMBOLS.includes(normalized as CryptoSymbol) ? (normalized as CryptoSymbol) : null;
    return symbol;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public normalize(payload: unknown): PolymarketMarket {
    if (!isRecord(payload)) {
      throw new MarketNormalizationError("Market payload must be an object", { payloadType: typeof payload });
    }
    const slug = String(payload.slug ?? "");
    const outcomes = this.parseStringArray(payload.outcomes);
    const clobTokenIds = this.parseStringArray(payload.clobTokenIds);
    const upTokenId = this.findTokenIdForOutcome(outcomes, clobTokenIds, "up");
    const downTokenId = this.findTokenIdForOutcome(outcomes, clobTokenIds, "down");
    if (!upTokenId) {
      throw MarketNormalizationError.forSlug(slug, "missing up token id");
    }
    if (!downTokenId) {
      throw MarketNormalizationError.forSlug(slug, "missing down token id");
    }
    const normalized: PolymarketMarket = {
      id: String(payload.id ?? ""),
      slug,
      question: String(payload.question ?? ""),
      symbol: this.parseSymbol(slug),
      conditionId: String(payload.conditionId ?? ""),
      outcomes,
      clobTokenIds,
      upTokenId,
      downTokenId,
      orderMinSize: Number(payload.orderMinSize ?? 0),
      orderPriceMinTickSize: payload.orderPriceMinTickSize ? String(payload.orderPriceMinTickSize) : null,
      eventStartTime: String(payload.eventStartTime ?? ""),
      endDate: String(payload.endDate ?? ""),
      start: new Date(String(payload.eventStartTime ?? "")),
      end: new Date(String(payload.endDate ?? "")),
      raw: payload
    };
    return normalized;
  }

  /**
   * @section static:methods
   */

  // empty
}
