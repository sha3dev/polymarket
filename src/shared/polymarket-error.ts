export class PolymarketError extends Error {
  public readonly context: Record<string, unknown>;

  public constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "PolymarketError";
    this.context = context ?? {};
  }
}
