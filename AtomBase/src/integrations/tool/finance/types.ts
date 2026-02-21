/**
 * Finance Analyze Tool - Type Definitions
 *
 * Multi-asset analysis types supporting crypto, stocks, commodities, forex, and indices.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ASSET TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type AssetType = "crypto" | "stock" | "etf" | "commodity" | "forex" | "index"

// ═══════════════════════════════════════════════════════════════════════════════
// OHLC DATA
// ═══════════════════════════════════════════════════════════════════════════════

export interface OHLC {
    timestamp: Date
    open: number
    high: number
    low: number
    close: number
    volume: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE DATA
// ═══════════════════════════════════════════════════════════════════════════════

export interface PriceData {
    symbol: string
    name: string
    assetType: AssetType
    price: number
    change24h: number
    changePercent24h: number
    volume24h: number
    high24h: number
    low24h: number
    open: number
    previousClose: number
    marketCap?: number
    currency: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export type SignalType = "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL"
export type TrendType = "BULLISH" | "BEARISH"
export type TrendDirection = "UPTREND" | "DOWNTREND" | "SIDEWAYS"
export type VolumeTrend = "HIGH" | "LOW" | "NORMAL"

export interface TechnicalAnalysis {
    // Oscillators
    rsi: number
    rsiSignal: SignalType
    rsiDivergence: string

    // MACD
    macd: number
    macdSignal: number
    macdHistogram: number
    macdTrend: TrendType

    // Bollinger Bands
    bbUpper: number
    bbMiddle: number
    bbLower: number
    bbSignal: SignalType

    // VWAP (mainly for crypto/intraday)
    vwap: number
    vwapSignal: TrendType

    // Moving Averages
    sma20: number
    sma50: number
    sma200: number
    ema12: number
    ema26: number

    // Trend
    trend: TrendDirection
    volumeTrend: VolumeTrend
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRYPTO-SPECIFIC DATA
// ═══════════════════════════════════════════════════════════════════════════════

export interface DerivativesData {
    openInterest: number
    openInterestUsd: number
    oiDeltaPercent: number
    fundingRate: number
    markPrice: number
    longShortRatio: number
    seniorSignal: string
    seniorNote: string
}

export interface OrderBookAnalysis {
    bidAskRatio2pct: number
    bidDepth2pct: number
    askDepth2pct: number
    majorBuyWall: string | null
    majorSellWall: string | null
    seniorWallCheck: string
}

export interface FearGreedData {
    value: number
    classification: string
}

export interface LiquidationLevel {
    type: "Short Liquidation" | "Long Liquidation"
    leverage: string
    priceLevel: number
    volumeEstimate: "High" | "Medium" | "Low"
    reference: string
}

export interface CryptoExtras {
    derivatives?: DerivativesData
    orderBook?: OrderBookAnalysis
    fearGreed?: FearGreedData
    liquidations?: LiquidationLevel[]
    trending?: string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK-SPECIFIC DATA
// ═══════════════════════════════════════════════════════════════════════════════

export interface StockExtras {
    pe?: number
    eps?: number
    dividendYield?: number
    beta?: number
    fiftyTwoWeekHigh: number
    fiftyTwoWeekLow: number
    avgVolume: number
    sector?: string
    industry?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MARKET DATA
// ═══════════════════════════════════════════════════════════════════════════════

export interface GlobalMarket {
    totalMarketCapUsd: number
    totalVolume24hUsd: number
    btcDominance: number
    ethDominance: number
    activeCryptos: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENIOR ANALYST CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

export interface SeniorChecks {
    riskScore: number // 0-100
    volumeTrap: boolean
    volumeTrapNote: string
    fundingAnalysis?: {
        signal: string
        interpretation: string
    }
    warnings: string[]
    signals: string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

export interface FinanceAnalysis {
    symbol: string
    ticker: string
    assetType: AssetType
    timestamp: string

    price: PriceData
    technical: TechnicalAnalysis
    klines: OHLC[]

    // Asset-specific data
    crypto?: CryptoExtras
    stock?: StockExtras
    global?: GlobalMarket

    // Senior Analyst
    seniorChecks: SeniorChecks
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface FinanceAnalyzeParams {
    symbol: string
    type?: AssetType
    detailed?: boolean
}
