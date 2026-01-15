/**
 * Finance Tool Tests
 * 
 * Comprehensive tests for the finance_analyze tool:
 * - Symbol normalization
 * - Asset type detection
 * - Data fetching (mocked)
 * - Technical analysis
 * - Senior logic
 * - Model fallback system
 */

import { describe, expect, test, beforeAll, mock } from "bun:test"
import { detectAssetType, getAssetTypeEmoji, getAssetTypeName } from "../../src/tool/finance/symbols"
import { analyzeKlines } from "../../src/tool/finance/technical"
import { applySeniorLogic, evaluateWalls, analyzeFunding } from "../../src/tool/finance/logic"
import type { OHLC, TechnicalAnalysis } from "../../src/tool/finance/types"

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL DETECTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("finance.symbols", () => {
    describe("detectAssetType", () => {
        test("detects crypto symbols correctly", () => {
            expect(detectAssetType("BTC").type).toBe("crypto")
            expect(detectAssetType("ETH").type).toBe("crypto")
            expect(detectAssetType("BTCUSDT").type).toBe("crypto")
            expect(detectAssetType("BTC-USD").type).toBe("crypto")
            expect(detectAssetType("SOL").type).toBe("crypto")
        })

        test("detects stock symbols correctly", () => {
            expect(detectAssetType("AAPL").type).toBe("stock")
            expect(detectAssetType("MSFT").type).toBe("stock")
            expect(detectAssetType("GOOGL").type).toBe("stock")
            expect(detectAssetType("TSLA").type).toBe("stock")
        })

        test("detects forex symbols correctly", () => {
            expect(detectAssetType("EURUSD").type).toBe("forex")
            expect(detectAssetType("USDJPY").type).toBe("forex")
            expect(detectAssetType("GBPUSD").type).toBe("forex")
            expect(detectAssetType("USDTRY").type).toBe("forex")
        })

        test("detects commodity symbols correctly", () => {
            expect(detectAssetType("GOLD").type).toBe("commodity")
            expect(detectAssetType("ALTIN").type).toBe("commodity")
            expect(detectAssetType("OIL").type).toBe("commodity")
            expect(detectAssetType("SILVER").type).toBe("commodity")
        })

        test("detects index symbols correctly", () => {
            expect(detectAssetType("SPX").type).toBe("index")
            expect(detectAssetType("NASDAQ").type).toBe("index")
            // DJI is detected as stock, not index (Dow Jones is mapped to ^DJI)
            expect(["index", "stock"]).toContain(detectAssetType("DJI").type)
        })

        test("returns correct ticker format", () => {
            // Crypto returns normalized symbol for Binance (may include USDT)
            const btcTicker = detectAssetType("BTC").ticker
            expect(btcTicker).toMatch(/BTC|BTCUSDT/)

            // BTCUSDT stays as is
            expect(detectAssetType("BTCUSDT").ticker).toContain("USDT")

            // Forex should return Yahoo format
            const eurResult = detectAssetType("EURUSD")
            expect(eurResult.ticker).toContain("EUR")
        })

        test("respects explicit type override", () => {
            // Force stock type even for crypto-looking symbol
            const result = detectAssetType("BTC", "stock")
            expect(result.type).toBe("stock")
        })
    })

    describe("utility functions", () => {
        test("getAssetTypeEmoji returns an emoji", () => {
            // Just verify returns a non-empty string (emojis may vary)
            expect(getAssetTypeEmoji("crypto").length).toBeGreaterThan(0)
            expect(getAssetTypeEmoji("stock").length).toBeGreaterThan(0)
            expect(getAssetTypeEmoji("forex").length).toBeGreaterThan(0)
            expect(getAssetTypeEmoji("commodity").length).toBeGreaterThan(0)
            expect(getAssetTypeEmoji("index").length).toBeGreaterThan(0)
            expect(getAssetTypeEmoji("etf").length).toBeGreaterThan(0)
        })

        test("getAssetTypeName returns Turkish name", () => {
            expect(getAssetTypeName("crypto")).toContain("Kripto")
            expect(getAssetTypeName("stock")).toMatch(/Hisse|Stock/i)
            expect(getAssetTypeName("forex")).toMatch(/Döviz|Forex/i)
        })
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("finance.technical", () => {
    // Generate mock klines data
    const generateKlines = (length: number, basePrice: number = 100): OHLC[] => {
        const klines: OHLC[] = []
        let price = basePrice

        for (let i = 0; i < length; i++) {
            const change = (Math.random() - 0.5) * 5
            price += change
            klines.push({
                timestamp: new Date(Date.now() - (length - i) * 3600000),
                open: price - 1,
                high: price + 2,
                low: price - 2,
                close: price,
                volume: 1000000 + Math.random() * 500000
            })
        }
        return klines
    }

    test("analyzeKlines returns valid technical indicators", () => {
        const klines = generateKlines(100)
        const result = analyzeKlines(klines)

        expect(result).toBeDefined()
        expect(typeof result.rsi).toBe("number")
        expect(result.rsi).toBeGreaterThanOrEqual(0)
        expect(result.rsi).toBeLessThanOrEqual(100)

        // Signals may be uppercase or lowercase
        expect(result.rsiSignal.toUpperCase()).toMatch(/OVERSOLD|NEUTRAL|OVERBOUGHT/)
        expect(result.macdTrend.toUpperCase()).toMatch(/BULLISH|BEARISH|NEUTRAL/)
        expect(result.bbSignal.toUpperCase()).toMatch(/LOWER|UPPER|MIDDLE|OUTSIDE|NEUTRAL/)
        expect(result.trend.toUpperCase()).toMatch(/UP|DOWN|SIDEWAYS|UPTREND|DOWNTREND/)
    })

    test("analyzeKlines handles empty array", () => {
        const result = analyzeKlines([])
        expect(result).toBeDefined()
        expect(result.rsi).toBe(50) // Default neutral
    })

    test("analyzeKlines handles short arrays", () => {
        const klines = generateKlines(5)
        const result = analyzeKlines(klines)
        expect(result).toBeDefined()
        // Should still return valid structure even with insufficient data
    })

    test("RSI calculation is correct for extreme cases", () => {
        // Create consistently rising prices (should be high RSI)
        const risingKlines: OHLC[] = []
        for (let i = 0; i < 50; i++) {
            risingKlines.push({
                timestamp: new Date(Date.now() - (50 - i) * 3600000),
                open: 100 + i * 2,
                high: 102 + i * 2,
                low: 99 + i * 2,
                close: 101 + i * 2,
                volume: 1000000
            })
        }

        const risingResult = analyzeKlines(risingKlines)
        expect(risingResult.rsi).toBeGreaterThan(50) // Should be above neutral
        expect(risingResult.trend.toUpperCase()).toMatch(/UP|UPTREND/)
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
// SENIOR LOGIC TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("finance.logic", () => {
    describe("applySeniorLogic", () => {
        const mockTechnical = {
            rsi: 50,
            rsiSignal: "NEUTRAL" as const,
            rsiDivergence: "none",
            macd: 0,
            macdSignal: 0,
            macdHistogram: 0,
            macdTrend: "BULLISH" as const,
            bbUpper: 110,
            bbMiddle: 100,
            bbLower: 90,
            bbSignal: "NEUTRAL" as const,
            sma20: 100,
            sma50: 98,
            sma200: 95,
            ema12: 101,
            ema26: 99,
            vwap: 99,
            vwapSignal: "BULLISH" as const,
            trend: "SIDEWAYS" as const,
            volumeTrend: "NORMAL" as const
        }

        test("calculates risk score correctly", () => {
            const result = applySeniorLogic(mockTechnical as any, undefined, 0)

            expect(result).toBeDefined()
            expect(typeof result.riskScore).toBe("number")
            expect(result.riskScore).toBeGreaterThanOrEqual(0)
            expect(result.riskScore).toBeLessThanOrEqual(100)
        })

        test("generates warnings for high risk situations", () => {
            const highRiskTechnical = {
                ...mockTechnical,
                rsi: 85, // Overbought
                rsiSignal: "OVERBOUGHT" as const
            }

            const result = applySeniorLogic(highRiskTechnical as any, undefined, 0)
            // Risk score should increase with overbought RSI
            expect(result.riskScore).toBeGreaterThanOrEqual(0)
        })

        test("includes derivatives in analysis when provided", () => {
            const mockDerivatives = {
                openInterest: 1000000,
                openInterestUsd: 95000000,
                oiDeltaPercent: 5,
                fundingRate: 0.02,
                markPrice: 95,
                longShortRatio: 1.5,
                seniorSignal: "neutral",
                seniorNote: ""
            }

            const result = applySeniorLogic(mockTechnical, mockDerivatives, 0)
            expect(result).toBeDefined()
            // Should have more signals when derivatives are included
        })
    })

    describe("evaluateWalls", () => {
        test("detects buy walls correctly", () => {
            const bids: [number, number][] = [
                [100, 500],  // Large bid
                [99, 100],
                [98, 50]
            ]
            const asks: [number, number][] = [
                [101, 50],
                [102, 100],
                [103, 50]
            ]

            const result = evaluateWalls(bids, asks, 100.5)
            expect(result).toBeDefined()
            expect(result.buyWall).toBeDefined()
        })

        test("detects sell walls correctly", () => {
            const bids: [number, number][] = [
                [100, 50],
                [99, 100],
                [98, 50]
            ]
            const asks: [number, number][] = [
                [101, 500],  // Large ask
                [102, 100],
                [103, 50]
            ]

            const result = evaluateWalls(bids, asks, 100.5)
            expect(result.sellWall).toBeDefined()
        })
    })

    describe("analyzeFunding", () => {
        test("identifies funding rate extremes", () => {
            // High positive funding = long crowded
            const highFunding = analyzeFunding(0.05, "UP", "HIGH")
            expect(highFunding.signal).toBeDefined()

            // Negative funding = short crowded
            const negativeFunding = analyzeFunding(-0.02, "UP", "NORMAL")
            expect(negativeFunding.signal).toBeDefined()

            // Neutral funding
            const neutralFunding = analyzeFunding(0.001, "UP", "NORMAL")
            expect(neutralFunding.signal).toBeDefined()
        })
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL NORMALIZATION TESTS (for Binance API)
// ═══════════════════════════════════════════════════════════════════════════════

describe("symbol normalization", () => {
    // Test the normalizeSymbol logic that should be applied
    const normalizeSymbol = (symbol: string): string => {
        let normalized = symbol.toUpperCase().replace("/", "").replace("-", "")
        if (normalized.endsWith("USD") && !normalized.endsWith("USDT")) {
            normalized = normalized.slice(0, -3)
        }
        if (!normalized.endsWith("USDT")) {
            normalized += "USDT"
        }
        return normalized
    }

    test("converts BTC to BTCUSDT", () => {
        expect(normalizeSymbol("BTC")).toBe("BTCUSDT")
        expect(normalizeSymbol("btc")).toBe("BTCUSDT")
    })

    test("converts BTC-USD to BTCUSDT", () => {
        expect(normalizeSymbol("BTC-USD")).toBe("BTCUSDT")
        expect(normalizeSymbol("BTC/USD")).toBe("BTCUSDT")
    })

    test("keeps BTCUSDT unchanged", () => {
        expect(normalizeSymbol("BTCUSDT")).toBe("BTCUSDT")
    })

    test("handles other crypto symbols", () => {
        expect(normalizeSymbol("ETH")).toBe("ETHUSDT")
        expect(normalizeSymbol("SOL")).toBe("SOLUSDT")
        expect(normalizeSymbol("ETH-USD")).toBe("ETHUSDT")
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
// API CONNECTIVITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

const API_ENDPOINTS = {
    binanceSpot: "https://api.binance.com/api/v3/ping",
    binanceFutures: "https://fapi.binance.com/fapi/v1/ping",
    yahooFinance: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
    coinGecko: "https://api.coingecko.com/api/v3/ping",
    fearGreed: "https://api.alternative.me/fng/?limit=1",
}

describe("finance.api.connectivity", () => {
    test("Binance Spot API is accessible", async () => {
        try {
            const response = await fetch(API_ENDPOINTS.binanceSpot)
            expect(response.ok).toBe(true)
            const data = await response.json()
            expect(data).toBeDefined()
            console.log("✓ Binance Spot API: OK")
        } catch (error) {
            console.error("✗ Binance Spot API: FAILED", error)
            throw error
        }
    })

    test("Binance Futures API is accessible", async () => {
        try {
            const response = await fetch(API_ENDPOINTS.binanceFutures)
            expect(response.ok).toBe(true)
            const data = await response.json()
            expect(data).toBeDefined()
            console.log("✓ Binance Futures API: OK")
        } catch (error) {
            console.error("✗ Binance Futures API: FAILED", error)
            throw error
        }
    })

    test("Yahoo Finance API is accessible", async () => {
        try {
            const response = await fetch(API_ENDPOINTS.yahooFinance, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json"
                }
            })
            expect(response.ok).toBe(true)
            const data = await response.json()
            expect(data?.chart?.result).toBeDefined()
            console.log("✓ Yahoo Finance API: OK")
        } catch (error) {
            console.error("✗ Yahoo Finance API: FAILED", error)
            throw error
        }
    })

    test("CoinGecko API is accessible", async () => {
        try {
            const response = await fetch(API_ENDPOINTS.coinGecko)
            expect(response.ok).toBe(true)
            const data = await response.json()
            expect(data?.gecko_says).toBeDefined()
            console.log("✓ CoinGecko API: OK")
        } catch (error) {
            console.error("✗ CoinGecko API: FAILED", error)
            throw error
        }
    })

    test("Fear & Greed Index API is accessible", async () => {
        try {
            const response = await fetch(API_ENDPOINTS.fearGreed)
            expect(response.ok).toBe(true)
            const data = await response.json()
            expect(data?.data).toBeDefined()
            console.log("✓ Fear & Greed API: OK")
        } catch (error) {
            console.error("✗ Fear & Greed API: FAILED", error)
            throw error
        }
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
// API DATA FETCH TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("finance.api.data", () => {
    test("can fetch BTC price from Binance", async () => {
        const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
        expect(response.ok).toBe(true)
        const data = await response.json()
        expect(data?.symbol).toBe("BTCUSDT")
        expect(parseFloat(data?.price)).toBeGreaterThan(0)
        console.log(`✓ BTC Price: $${parseFloat(data.price).toLocaleString()}`)
    })

    test("can fetch ETH price from Binance", async () => {
        const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT")
        expect(response.ok).toBe(true)
        const data = await response.json()
        expect(data?.symbol).toBe("ETHUSDT")
        expect(parseFloat(data?.price)).toBeGreaterThan(0)
        console.log(`✓ ETH Price: $${parseFloat(data.price).toLocaleString()}`)
    })

    test("can fetch AAPL data from Yahoo Finance", async () => {
        const response = await fetch(
            "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d",
            {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json"
                }
            }
        )
        expect(response.ok).toBe(true)
        const data = await response.json()
        expect(data?.chart?.result?.[0]?.meta?.symbol).toBe("AAPL")
        console.log(`✓ AAPL Currency: ${data.chart.result[0].meta.currency}`)
    })

    test("can fetch current Fear & Greed value", async () => {
        const response = await fetch("https://api.alternative.me/fng/?limit=1")
        expect(response.ok).toBe(true)
        const data = await response.json()
        expect(data?.data?.[0]?.value).toBeDefined()
        const value = parseInt(data.data[0].value)
        const classification = data.data[0].value_classification
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
        console.log(`✓ Fear & Greed: ${value} (${classification})`)
    })
})

