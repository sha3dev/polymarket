/**
 * Module Overview
 * File: src/lib/market/market.type.ts
 * Purpose: Define el tipo estructural de Market.
 * Role: Tipa payloads normalizados usados por el runtime.
 */
import type { CryptoSymbol } from "../utils";

export type Market = {
  id: string;
  symbol: CryptoSymbol;
  question: string;
  conditionId: string;
  slug: string;
  resolutionSource: string;
  endDate: string;
  startDate: string;
  image: string;
  icon: string;
  description: string;
  outcomes: string[];
  outcomePrices: string;
  volume: string;
  active: boolean;
  closed: boolean;
  marketMakerAddress: string;
  createdAt: string;
  updatedAt: string;
  new: boolean;
  featured: boolean;
  submitted_by?: string;
  archived: boolean;
  resolvedBy?: string;
  restricted: boolean;
  questionID: string;
  umaEndDate?: string;
  enableOrderBook: boolean;
  orderPriceMinTickSize?: string;
  orderMinSize: number;
  umaResolutionStatus?: string;
  volumeNum?: number;
  liquidityNum?: number;
  endDateIso?: string;
  startDateIso?: string;
  hasReviewedDates?: boolean;
  volume24hr?: number;
  volume1wk?: number;
  volume1mo?: number;
  volume1yr?: number;
  clobTokenIds: string[]; // JSON string array of token IDs
  umaBond?: string;
  umaReward?: string;
  volume24hrClob?: number;
  volume1wkClob?: number;
  volume1moClob?: number;
  volume1yrClob?: number;
  volumeClob?: number;
  liquidityClob?: number;
  customLiveness?: number;
  acceptingOrders?: boolean;
  negRisk?: boolean;
  negRiskRequestID?: string;
  ready?: boolean;
  funded?: boolean;
  acceptingOrdersTimestamp?: string;
  cyom?: boolean;
  competitive?: number;
  pagerDutyNotificationEnabled?: boolean;
  approved?: boolean;
  rewardsMinSize?: number;
  rewardsMaxSpread?: number;
  spread?: number;
  automaticallyResolved?: boolean;
  oneDayPriceChange?: number;
  oneHourPriceChange?: number;
  lastTradePrice?: number;
  bestAsk?: number;
  bestBid?: number;
  automaticallyActive?: boolean;
  clearBookOnStart?: boolean;
  manualActivation?: boolean;
  negRiskOther?: boolean;
  umaResolutionStatuses?: string;
  pendingDeployment?: boolean;
  deploying?: boolean;
  deployingTimestamp?: string;
  rfqEnabled?: boolean;
  eventStartTime: string;
  holdingRewardsEnabled?: boolean;
  feesEnabled?: boolean;
  requiresTranslation?: boolean;
  start: Date;
  end: Date;
  upTokenId: string;
  downTokenId: string;
  initialOrderBookSnapshot: {
    up: { date: Date; bids: { price: number; size: number }[]; asks: { price: number; size: number }[] };
    down: { date: Date; bids: { price: number; size: number }[]; asks: { price: number; size: number }[] };
  };
};
