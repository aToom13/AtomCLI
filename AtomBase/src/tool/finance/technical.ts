/**
 * Finance Analyze Tool - Technical Analysis
 *
 * Pure TypeScript implementations of technical indicators.
 * No external dependencies.
 */

import type { OHLC, TechnicalAnalysis, SignalType, TrendType, TrendDirection, VolumeTrend } from "./types"

// ═══════════════════════════════════════════════════════════════════════════════
// MOVING AVERAGES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simple Moving Average
 */
export function calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
        return prices.length > 0 ? prices[prices.length - 1] : 0
    }
    const slice = prices.slice(-period)
    return slice.reduce((sum, p) => sum + p, 0) / period
}

/**
 * Exponential Moving Average
 */
export function calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) {
        return prices.length > 0 ? prices[prices.length - 1] : 0
    }

    const multiplier = 2 / (period + 1)
    // Start with SMA
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period

    // Apply EMA formula
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema
    }

    return ema
}

// ═══════════════════════════════════════════════════════════════════════════════
// OSCILLATORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Relative Strength Index (RSI)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
        return 50 // Default neutral
    }

    const gains: number[] = []
    const losses: number[] = []

    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1]
        if (change > 0) {
            gains.push(change)
            losses.push(0)
        } else {
            gains.push(0)
            losses.push(Math.abs(change))
        }
    }

    if (gains.length < period) {
        return 50
    }

    // Calculate average gain and loss
    const avgGain = gains.slice(-period).reduce((sum, g) => sum + g, 0) / period
    const avgLoss = losses.slice(-period).reduce((sum, l) => sum + l, 0) / period

    if (avgLoss === 0) {
        return 100
    }

    const rs = avgGain / avgLoss
    const rsi = 100 - 100 / (1 + rs)

    return rsi
}

/**
 * Get RSI signal interpretation
 */
export function getRSISignal(rsi: number): SignalType {
    if (rsi > 70) return "OVERBOUGHT"
    if (rsi < 30) return "OVERSOLD"
    return "NEUTRAL"
}

/**
 * MACD - Moving Average Convergence Divergence
 */
export function calculateMACD(prices: number[]): {
    macd: number
    signal: number
    histogram: number
} {
    const ema12 = calculateEMA(prices, 12)
    const ema26 = calculateEMA(prices, 26)
    const macd = ema12 - ema26

    // Signal line (9-period EMA of MACD)
    // Simplified approximation
    const signal = macd * 0.8

    const histogram = macd - signal

    return { macd, signal, histogram }
}

/**
 * Get MACD trend
 */
export function getMACDTrend(macd: number, signal: number): TrendType {
    return macd > signal ? "BULLISH" : "BEARISH"
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANDS & ENVELOPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number } {
    if (prices.length < period) {
        const price = prices.length > 0 ? prices[prices.length - 1] : 0
        return {
            upper: price * 1.02,
            middle: price,
            lower: price * 0.98,
        }
    }

    const slice = prices.slice(-period)
    const middle = slice.reduce((sum, p) => sum + p, 0) / period

    // Standard deviation
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period
    const stdDev = Math.sqrt(variance)

    return {
        upper: middle + stdDevMultiplier * stdDev,
        middle,
        lower: middle - stdDevMultiplier * stdDev,
    }
}

/**
 * Get Bollinger Band signal
 */
export function getBBSignal(price: number, upper: number, lower: number): SignalType {
    if (price > upper) return "OVERBOUGHT"
    if (price < lower) return "OVERSOLD"
    return "NEUTRAL"
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLUME ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Volume Weighted Average Price (VWAP)
 */
export function calculateVWAP(prices: number[], volumes: number[]): number {
    if (prices.length === 0 || volumes.length === 0 || prices.length !== volumes.length) {
        return prices.length > 0 ? prices[prices.length - 1] : 0
    }

    let cumPV = 0
    let cumVol = 0

    for (let i = 0; i < prices.length; i++) {
        cumPV += prices[i] * volumes[i]
        cumVol += volumes[i]
    }

    if (cumVol === 0) {
        return prices[prices.length - 1]
    }

    return cumPV / cumVol
}

/**
 * Analyze volume trend
 */
export function analyzeVolumeTrend(volumes: number[], period: number = 20): VolumeTrend {
    if (volumes.length < period) {
        return "NORMAL"
    }

    const recentVolumes = volumes.slice(-period, -1)
    const avgVolume = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length
    const currentVolume = volumes[volumes.length - 1]

    if (currentVolume > avgVolume * 1.5) {
        return "HIGH"
    }
    if (currentVolume < avgVolume * 0.5) {
        return "LOW"
    }
    return "NORMAL"
}

// ═══════════════════════════════════════════════════════════════════════════════
// TREND ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determine trend direction from SMAs
 */
export function getTrendDirection(sma20: number, sma50: number): TrendDirection {
    const diff = (sma20 - sma50) / sma50

    if (diff > 0.01) return "UPTREND"
    if (diff < -0.01) return "DOWNTREND"
    return "SIDEWAYS"
}

/**
 * Check for RSI divergence (simplified)
 */
export function checkRSIDivergence(prices: number[], period: number = 14): string {
    if (prices.length < period + 15) {
        return "NO_DIVERGENCE"
    }

    // Calculate RSI for current and 14 periods ago
    const currentRSI = calculateRSI(prices, period)
    const pastRSI = calculateRSI(prices.slice(0, -14), period)

    const priceTrend = prices[prices.length - 1] - prices[prices.length - 15]
    const rsiTrend = currentRSI - pastRSI

    // Bearish divergence: price up, RSI down
    if (priceTrend > 0 && rsiTrend < -5) {
        return "BEARISH_DIVERGENCE"
    }

    // Bullish divergence: price down, RSI up
    if (priceTrend < 0 && rsiTrend > 5) {
        return "BULLISH_DIVERGENCE"
    }

    return "NO_DIVERGENCE"
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Perform full technical analysis on OHLC data
 */
export function analyzeKlines(klines: OHLC[]): TechnicalAnalysis {
    if (klines.length === 0) {
        return getEmptyTechnicalAnalysis()
    }

    const closes = klines.map((k) => k.close)
    const volumes = klines.map((k) => k.volume)
    const currentPrice = closes[closes.length - 1]

    // Calculate all indicators
    const rsi = calculateRSI(closes)
    const rsiSignal = getRSISignal(rsi)
    const rsiDivergence = checkRSIDivergence(closes)

    const { macd, signal: macdSignal, histogram: macdHistogram } = calculateMACD(closes)
    const macdTrend = getMACDTrend(macd, macdSignal)

    const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = calculateBollingerBands(closes)
    const bbSignal = getBBSignal(currentPrice, bbUpper, bbLower)

    const vwap = calculateVWAP(closes, volumes)
    const vwapSignal: TrendType = currentPrice > vwap ? "BULLISH" : "BEARISH"

    const sma20 = calculateSMA(closes, 20)
    const sma50 = calculateSMA(closes, 50)
    const sma200 = calculateSMA(closes, 200)
    const ema12 = calculateEMA(closes, 12)
    const ema26 = calculateEMA(closes, 26)

    const trend = getTrendDirection(sma20, sma50)
    const volumeTrend = analyzeVolumeTrend(volumes)

    return {
        rsi,
        rsiSignal,
        rsiDivergence,
        macd,
        macdSignal,
        macdHistogram,
        macdTrend,
        bbUpper,
        bbMiddle,
        bbLower,
        bbSignal,
        vwap,
        vwapSignal,
        sma20,
        sma50,
        sma200,
        ema12,
        ema26,
        trend,
        volumeTrend,
    }
}

/**
 * Return empty/default technical analysis
 */
function getEmptyTechnicalAnalysis(): TechnicalAnalysis {
    return {
        rsi: 50,
        rsiSignal: "NEUTRAL",
        rsiDivergence: "NO_DIVERGENCE",
        macd: 0,
        macdSignal: 0,
        macdHistogram: 0,
        macdTrend: "BULLISH",
        bbUpper: 0,
        bbMiddle: 0,
        bbLower: 0,
        bbSignal: "NEUTRAL",
        vwap: 0,
        vwapSignal: "BULLISH",
        sma20: 0,
        sma50: 0,
        sma200: 0,
        ema12: 0,
        ema26: 0,
        trend: "SIDEWAYS",
        volumeTrend: "NORMAL",
    }
}
