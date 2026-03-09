/**
 * @section imports:internals
 */

import type { CryptoSymbol, PolymarketMarket } from "./market.types.ts";

export class MarketNormalizerService {
  /**
   * @section factory
   */

  public static create(): MarketNormalizerService {
    const service = new MarketNormalizerService();
    return service;
  }

  /**
   * @section private:methods
   */

  private readRecord(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Failed to normalize market payload: expected an object payload.");
    }
    const record = payload as Record<string, unknown>;
    return record;
  }

  private readStringValue(payload: Record<string, unknown>, key: string): string {
    const rawValue = payload[key];
    if (typeof rawValue !== "string" || rawValue.length === 0) {
      throw new Error(`Failed to normalize market payload: expected '${key}' to be a non-empty string.`);
    }
    const stringValue = rawValue;
    return stringValue;
  }

  private readStringArrayValue(payload: Record<string, unknown>, key: string): string[] {
    const rawValue = payload[key];
    let parsedValue: unknown = rawValue;
    if (typeof rawValue === "string") {
      try {
        parsedValue = JSON.parse(rawValue) as unknown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to normalize market payload: '${key}' is not valid JSON. ${reason}`);
      }
    }
    if (!Array.isArray(parsedValue) || parsedValue.some((entry) => typeof entry !== "string")) {
      throw new Error(`Failed to normalize market payload: expected '${key}' to be a string array.`);
    }
    const stringArray = parsedValue as string[];
    return stringArray;
  }

  private readNumericValue(payload: Record<string, unknown>, key: string, fallback: number): number {
    const rawValue = payload[key];
    const parsedValue = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue) : Number.NaN;
    const numericValue = Number.isFinite(parsedValue) ? parsedValue : fallback;
    return numericValue;
  }

  private readOptionalStringValue(payload: Record<string, unknown>, key: string): string | null {
    const rawValue = payload[key];
    const stringValue = typeof rawValue === "string" && rawValue.length > 0 ? rawValue : null;
    return stringValue;
  }

  private readSymbol(slug: string): CryptoSymbol | null {
    const prefix = slug.split("-")[0] ?? "";
    const symbol: CryptoSymbol | null = prefix === "btc" || prefix === "eth" || prefix === "sol" || prefix === "xrp" ? prefix : null;
    return symbol;
  }

  /**
   * @section public:methods
   */

  public normalize(payload: unknown): PolymarketMarket {
    const marketRecord = this.readRecord(payload);
    const slug = this.readStringValue(marketRecord, "slug");
    const outcomes = this.readStringArrayValue(marketRecord, "outcomes");
    const clobTokenIds = this.readStringArrayValue(marketRecord, "clobTokenIds");
    const upIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "up");
    const downIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "down");
    if (upIndex < 0 || downIndex < 0 || !clobTokenIds[upIndex] || !clobTokenIds[downIndex]) {
      throw new Error(`Failed to normalize market '${slug}': expected Up/Down outcomes with matching token ids.`);
    }
    const eventStartTime = this.readStringValue(marketRecord, "eventStartTime");
    const endDate = this.readStringValue(marketRecord, "endDate");
    const market: PolymarketMarket = {
      id: this.readStringValue(marketRecord, "id"),
      slug,
      question: this.readOptionalStringValue(marketRecord, "question") ?? slug,
      symbol: this.readSymbol(slug),
      conditionId: this.readStringValue(marketRecord, "conditionId"),
      outcomes,
      clobTokenIds,
      upTokenId: clobTokenIds[upIndex]!,
      downTokenId: clobTokenIds[downIndex]!,
      orderMinSize: this.readNumericValue(marketRecord, "orderMinSize", 0),
      orderPriceMinTickSize: this.readOptionalStringValue(marketRecord, "orderPriceMinTickSize"),
      eventStartTime,
      endDate,
      start: new Date(eventStartTime),
      end: new Date(endDate),
      raw: marketRecord
    };
    return market;
  }
}
