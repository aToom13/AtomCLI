/**
 * Finance Analyze Tool - Senior Analyst Logic
 *
 * Hard-coded rules to prevent LLM hallucinations and naive interpretations.
 * Ported from LLMcripto's analysis/logic.py
 */

import type { FinanceAnalysis, TechnicalAnalysis, DerivativesData, SeniorChecks } from "./types"

// ═══════════════════════════════════════════════════════════════════════════════
// FUNDING RATE ANALYSIS (Crypto Only)
// ═══════════════════════════════════════════════════════════════════════════════

type PriceTrend = "UP" | "DOWN"
type VolumeTrendType = "HIGH" | "LOW" | "NORMAL"

interface FundingAnalysis {
    signal: string
    interpretation: string
}

/**
 * Analyzes Funding Rate with Context.
 * Rule: Funding > -0.01% is NEUTRAL (Hedge/Arbitrage), not Squeeze.
 */
export function analyzeFunding(
    fundingRate: number,
    priceTrend: PriceTrend,
    volumeTrend: VolumeTrendType
): FundingAnalysis {
    // Normalize funding rate (some APIs return as decimal, some as percentage)
    const normalizedFunding = Math.abs(fundingRate) < 0.01 ? fundingRate : fundingRate / 100

    if (normalizedFunding < -0.0001) {
        // Negative funding
        if (priceTrend === "UP" && volumeTrend === "HIGH") {
            return {
                signal: "BULLISH_SQUEEZE",
                interpretation:
                    "High negative funding with rising price & volume indicates genuine squeeze pressure. Shorts are paying longs.",
            }
        } else if (priceTrend === "UP" && volumeTrend === "LOW") {
            return {
                signal: "BEAR_TRAP",
                interpretation:
                    "Price rising on low volume with negative funding suggests trap/manipulation. Be cautious.",
            }
        } else {
            return {
                signal: "BEARISH_HEAVY_SHORT",
                interpretation: "Market is heavily short. Potential squeeze if trend reverses.",
            }
        }
    } else if (normalizedFunding > 0.0001) {
        // Positive funding
        if (normalizedFunding > 0.0005) {
            return {
                signal: "BULLISH_OVERHEATED",
                interpretation:
                    "High positive funding indicates long dominance. Market overheated, correction risk.",
            }
        }
        return {
            signal: "SLIGHT_LONG_BIAS",
            interpretation: "Slight long bias in funding. Market balanced.",
        }
    }

    return {
        signal: "NEUTRAL",
        interpretation: "Funding rate is insignificant. No clear directional bias from derivatives.",
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLUME DIVERGENCE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detects anomalies like 'Price Up + Volume Low'
 */
export function validateVolumeDivergence(
    priceTrend: PriceTrend,
    volumeTrend: VolumeTrendType,
    rsi: number
): { isValid: boolean; warning: string } {
    if (priceTrend === "UP" && volumeTrend === "LOW") {
        return {
            isValid: false,
            warning:
                "⚠️ VOLUME TRAP: Price rising on declining volume. High reversal risk. Could also be 'Wall of Worry' (Supply Shock) - check VWAP position.",
        }
    }

    if (priceTrend === "DOWN" && volumeTrend === "LOW") {
        return {
            isValid: true,
            warning: "ℹ️ Selling pressure drying up. Potential bottom forming.",
        }
    }

    if (rsi > 75 && volumeTrend === "LOW") {
        return {
            isValid: false,
            warning: "⚠️ EXTREME: Overbought + Low Volume = Exhaustion. High reversal probability.",
        }
    }

    if (priceTrend === "UP" && volumeTrend === "HIGH") {
        return {
            isValid: true,
            warning: "✅ Healthy trend. Price and volume aligned.",
        }
    }

    return {
        isValid: true,
        warning: "",
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER BOOK WALL EVALUATION (Crypto Only)
// ═══════════════════════════════════════════════════════════════════════════════

interface WallEvaluation {
    buyWall: string | null
    sellWall: string | null
    interpretation: string
}

/**
 * Filters out 'Noise' walls (<50 BTC for BTC pairs)
 */
export function evaluateWalls(
    bids: [number, number][],
    asks: [number, number][],
    currentPrice: number,
    significantThreshold: number = 50 // BTC
): WallEvaluation {
    // Filter significant walls
    const validBids = bids.filter(([_, qty]) => qty >= significantThreshold)
    const validAsks = asks.filter(([_, qty]) => qty >= significantThreshold)

    const closestBid = validBids[0]
    const closestAsk = validAsks[0]

    const buyWall = closestBid ? `$${closestBid[0].toLocaleString()} (${closestBid[1].toFixed(1)} BTC)` : null

    const sellWall = closestAsk ? `$${closestAsk[0].toLocaleString()} (${closestAsk[1].toFixed(1)} BTC)` : null

    let interpretation: string
    if (validBids.length > 0 && validAsks.length === 0) {
        interpretation = "Strong buy support, no significant sell walls. Bullish order book."
    } else if (validAsks.length > 0 && validBids.length === 0) {
        interpretation = "Strong sell pressure, no significant buy support. Bearish order book."
    } else if (validBids.length > 0 && validAsks.length > 0) {
        const bidValue = validBids.reduce((sum, [p, q]) => sum + p * q, 0)
        const askValue = validAsks.reduce((sum, [p, q]) => sum + p * q, 0)
        const ratio = bidValue / askValue
        if (ratio > 1.5) {
            interpretation = "Bid-heavy order book. Bullish bias."
        } else if (ratio < 0.67) {
            interpretation = "Ask-heavy order book. Bearish bias."
        } else {
            interpretation = "Balanced order book with significant walls on both sides."
        }
    } else {
        interpretation = "No significant walls detected (>50 BTC). Order book is thin or spoofed."
    }

    return { buyWall, sellWall, interpretation }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK/REWARD VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

interface RiskRewardResult {
    ratio: number
    grade: "A" | "B" | "C" | "F"
    verdict: string
    isApproved: boolean
}

/**
 * Auto-rejects bad R:R setups
 */
export function checkRiskReward(entry: number, target: number, stop: number): RiskRewardResult {
    if (entry === stop) {
        return {
            ratio: 0,
            grade: "F",
            verdict: "INVALID: Entry equals Stop",
            isApproved: false,
        }
    }

    const reward = Math.abs(target - entry)
    const risk = Math.abs(entry - stop)

    if (risk === 0) {
        return {
            ratio: 0,
            grade: "F",
            verdict: "INVALID: Zero Risk (Impossible)",
            isApproved: false,
        }
    }

    const ratio = reward / risk

    if (ratio >= 3.0) {
        return { ratio, grade: "A", verdict: `✅ EXCELLENT (R:R ${ratio.toFixed(2)}:1)`, isApproved: true }
    }
    if (ratio >= 2.0) {
        return { ratio, grade: "B", verdict: `✅ GOOD (R:R ${ratio.toFixed(2)}:1)`, isApproved: true }
    }
    if (ratio >= 1.5) {
        return { ratio, grade: "C", verdict: `⚠️ MARGINAL (R:R ${ratio.toFixed(2)}:1)`, isApproved: false }
    }

    return {
        ratio,
        grade: "F",
        verdict: `❌ REJECTED (R:R ${ratio.toFixed(2)}:1). Minimum 2.0 required.`,
        isApproved: false,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK SCORE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

interface RiskFactors {
    volumeTrap: boolean
    etfDataMissing?: boolean
    longLiquidationNear?: boolean
    fundingExtreme?: boolean
    macroRisk?: boolean
    blindSpots: number
}

/**
 * Calculate overall risk score (0-100)
 */
export function calculateRiskScore(factors: RiskFactors): number {
    let score = 0

    if (factors.volumeTrap) score += 30
    if (factors.etfDataMissing) score += 15
    if (factors.longLiquidationNear) score += 20
    if (factors.fundingExtreme) score += 15
    if (factors.macroRisk) score += 10

    // Each blind spot adds 5 points
    score += factors.blindSpots * 5

    return Math.min(100, score)
}

/**
 * Get risk level from score
 */
export function getRiskLevel(score: number): string {
    if (score >= 70) return "HIGH"
    if (score >= 40) return "MEDIUM"
    return "LOW"
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLY ALL SENIOR LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apply all senior analyst checks to the analysis
 */
export function applySeniorLogic(
    technical: TechnicalAnalysis,
    derivatives?: DerivativesData,
    priceChange?: number
): SeniorChecks {
    const warnings: string[] = []
    const signals: string[] = []

    // Determine price trend
    const priceTrend: PriceTrend = (priceChange ?? 0) >= 0 ? "UP" : "DOWN"

    // Volume divergence check
    const volumeCheck = validateVolumeDivergence(priceTrend, technical.volumeTrend, technical.rsi)
    const volumeTrap = !volumeCheck.isValid
    const volumeTrapNote = volumeCheck.warning

    if (volumeTrap) {
        warnings.push(volumeTrapNote)
    } else if (volumeCheck.warning) {
        signals.push(volumeCheck.warning)
    }

    // RSI divergence
    if (technical.rsiDivergence === "BEARISH_DIVERGENCE") {
        warnings.push("⚠️ RSI Bearish Divergence: Price making highs but RSI declining. Potential top.")
    } else if (technical.rsiDivergence === "BULLISH_DIVERGENCE") {
        signals.push("✅ RSI Bullish Divergence: Price making lows but RSI rising. Potential bottom.")
    }

    // Funding analysis (if crypto)
    let fundingAnalysis: FundingAnalysis | undefined
    if (derivatives) {
        fundingAnalysis = analyzeFunding(derivatives.fundingRate, priceTrend, technical.volumeTrend)

        if (fundingAnalysis.signal.includes("SQUEEZE")) {
            signals.push(`🚀 ${fundingAnalysis.signal}: ${fundingAnalysis.interpretation}`)
        } else if (fundingAnalysis.signal.includes("OVERHEATED")) {
            warnings.push(`⚠️ ${fundingAnalysis.signal}: ${fundingAnalysis.interpretation}`)
        }
    }

    // Overbought/Oversold
    if (technical.rsiSignal === "OVERBOUGHT") {
        warnings.push("⚠️ RSI Overbought (>70): Caution on new longs.")
    } else if (technical.rsiSignal === "OVERSOLD") {
        signals.push("✅ RSI Oversold (<30): Potential bounce zone.")
    }

    // Calculate risk score
    const riskFactors: RiskFactors = {
        volumeTrap,
        fundingExtreme: derivatives && Math.abs(derivatives.fundingRate) > 0.0005,
        longLiquidationNear: false, // Would need liquidation data
        blindSpots: 0,
    }
    const riskScore = calculateRiskScore(riskFactors)

    return {
        riskScore,
        volumeTrap,
        volumeTrapNote,
        fundingAnalysis,
        warnings,
        signals,
    }
}
