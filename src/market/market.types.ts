export type CryptoSymbol = "btc" | "eth" | "sol" | "xrp";

export type CryptoMarketWindow = "5m" | "15m";

export type OrderBookLevel = { price: number; size: number };

export type OrderBook = { bids: OrderBookLevel[]; asks: OrderBookLevel[] };

export type PolymarketMarket = {
  id: string;
  slug: string;
  question: string;
  symbol: CryptoSymbol | null;
  conditionId: string;
  outcomes: string[];
  clobTokenIds: string[];
  upTokenId: string;
  downTokenId: string;
  orderMinSize: number;
  orderPriceMinTickSize: string | null;
  eventStartTime: string;
  endDate: string;
  start: Date;
  end: Date;
  raw: Record<string, unknown>;
};

export type LoadMarketBySlugOptions = { slug: string };

export type LoadMarketsBySlugsOptions = { slugs: string[] };

export type BuildCryptoWindowSlugsOptions = { date: Date; window: CryptoMarketWindow; symbols?: CryptoSymbol[] };

export type LoadCryptoWindowMarketsOptions = { date: Date; window: CryptoMarketWindow; symbols?: CryptoSymbol[] };
