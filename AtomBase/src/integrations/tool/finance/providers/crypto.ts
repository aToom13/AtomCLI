/**
 * Finance Analyze Tool - Crypto Data Provider
 *
 * Fetches data from Binance and CoinGecko APIs.
 * No API key required.
 */

import type {
    PriceData,
    OHLC,
    DerivativesData,
    OrderBookAnalysis,
    FearGreedData,
    GlobalMarket,
    LiquidationLevel,
    CryptoExtras,
} from "../types"
import { evaluateWalls, analyzeFunding } from "../logic"

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

const BINANCE_API = "https://api.binance.com/api/v3"
const BINANCE_FUTURES = "https://fapi.binance.com/fapi/v1"
const BINANCE_FUTURES_DATA = "https://fapi.binance.com/futures/data" // For Long/Short ratio
const COINGECKO_API = "https://api.coingecko.com/api/v3"
const FEAR_GREED_API = "https://api.alternative.me/fng/"

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL NORMALIZATION (LLMcripto Compatible)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize crypto symbol to Binance format (BTCUSDT)
 * - BTC → BTCUSDT
 * - BTC-USD → BTCUSDT
 * - BTCUSDT → BTCUSDT (unchanged)
 */
function normalizeSymbol(symbol: string): string {
    let normalized = symbol.toUpperCase().replace("/", "").replace("-", "")

    // Remove trailing USD if present (BTC-USD → BTC)
    if (normalized.endsWith("USD") && !normalized.endsWith("USDT")) {
        normalized = normalized.slice(0, -3)
    }

    // Add USDT suffix if missing
    if (!normalized.endsWith("USDT")) {
        normalized += "USDT"
    }

    return normalized
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

const rateLimitState: Record<string, number[]> = {}

async function waitForRateLimit(key: string, maxCalls: number, periodMs: number): Promise<void> {
    const now = Date.now()
    const timestamps = rateLimitState[key] || []

    // Remove old timestamps
    rateLimitState[key] = timestamps.filter((t) => now - t < periodMs)

    if (rateLimitState[key].length >= maxCalls) {
        const waitTime = rateLimitState[key][0] + periodMs - now
        if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime))
        }
    }

    rateLimitState[key].push(Date.now())
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function safeFetch(url: string, limiterKey: string = "default"): Promise<Response | null> {
    const limits: Record<string, [number, number]> = {
        binance: [1200, 60000], // 1200 req/min
        coingecko: [10, 60000], // 10 req/min
        default: [10, 1000], // 10 req/sec
    }

    const [maxCalls, period] = limits[limiterKey] || limits.default
    await waitForRateLimit(limiterKey, maxCalls, period)

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "AtomCLI/1.0",
            },
        })

        if (!response.ok) {
            console.error(`HTTP ${response.status} for ${url}`)
            return null
        }

        return response
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error)
        return null
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BINANCE API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch crypto price from Binance
 */
export async function fetchCryptoPrice(symbol: string): Promise<PriceData> {
    const normalizedSymbol = normalizeSymbol(symbol)
    const url = `${BINANCE_API}/ticker/24hr?symbol=${normalizedSymbol}`

    const response = await safeFetch(url, "binance")
    if (!response) {
        throw new Error(`Failed to fetch price for ${symbol}`)
    }

    const data = await response.json()

    return {
        symbol: normalizedSymbol,
        name: normalizedSymbol.replace("USDT", ""),
        assetType: "crypto",
        price: parseFloat(data.lastPrice),
        change24h: parseFloat(data.priceChange),
        changePercent24h: parseFloat(data.priceChangePercent),
        volume24h: parseFloat(data.quoteVolume),
        high24h: parseFloat(data.highPrice),
        low24h: parseFloat(data.lowPrice),
        open: parseFloat(data.openPrice),
        previousClose: parseFloat(data.prevClosePrice),
        currency: "USD",
    }
}

/**
 * Fetch OHLC klines from Binance
 */
export async function fetchCryptoKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 100
): Promise<OHLC[]> {
    const normalizedSymbol = normalizeSymbol(symbol)
    const url = `${BINANCE_API}/klines?symbol=${normalizedSymbol}&interval=${interval}&limit=${limit}`

    const response = await safeFetch(url, "binance")
    if (!response) {
        return []
    }

    const data = await response.json()

    return data.map((k: any[]) => ({
        timestamp: new Date(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
    }))
}

/**
 * Fetch derivatives data from Binance Futures
 */
export async function fetchDerivatives(symbol: string): Promise<DerivativesData | null> {
    const normalizedSymbol = normalizeSymbol(symbol)

    try {
        // Open Interest
        const oiResponse = await safeFetch(`${BINANCE_FUTURES}/openInterest?symbol=${normalizedSymbol}`, "binance")
        if (!oiResponse) return null
        const oiData = await oiResponse.json()

        // Premium Index (Funding Rate + Mark Price)
        const frResponse = await safeFetch(`${BINANCE_FUTURES}/premiumIndex?symbol=${normalizedSymbol}`, "binance")
        const frData = frResponse ? await frResponse.json() : { lastFundingRate: 0, markPrice: 0 }

        // Long/Short Ratio - use /futures/data/ path (not /fapi/v1/)
        const lsResponse = await safeFetch(
            `${BINANCE_FUTURES_DATA}/globalLongShortAccountRatio?symbol=${normalizedSymbol}&period=4h&limit=1`,
            "binance"
        )
        const lsData = lsResponse ? await lsResponse.json() : []

        const fundingRate = parseFloat(frData.lastFundingRate || "0")
        const markPrice = parseFloat(frData.markPrice || "0")
        const openInterest = parseFloat(oiData.openInterest || "0")
        const openInterestUsd = openInterest * markPrice
        const longShortRatio = lsData.length > 0 ? parseFloat(lsData[0].longShortRatio || "1") : 1.0

        // Senior logic analysis
        const fundingAnalysis = analyzeFunding(fundingRate, "UP", "NORMAL")

        return {
            openInterest,
            openInterestUsd,
            oiDeltaPercent: 0, // Would need historical data
            fundingRate,
            markPrice,
            longShortRatio,
            seniorSignal: fundingAnalysis.signal,
            seniorNote: fundingAnalysis.interpretation,
        }
    } catch (error) {
        console.error("Failed to fetch derivatives:", error)
        return null
    }
}

/**
 * Fetch order book from Binance
 */
export async function fetchOrderBook(symbol: string, limit: number = 500): Promise<OrderBookAnalysis | null> {
    const normalizedSymbol = normalizeSymbol(symbol)
    const url = `${BINANCE_API}/depth?symbol=${normalizedSymbol}&limit=${limit}`

    const response = await safeFetch(url, "binance")
    if (!response) return null

    const data = await response.json()
    const bids: [number, number][] = data.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])])
    const asks: [number, number][] = data.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])

    if (bids.length === 0 || asks.length === 0) return null

    // Calculate 2% depth
    const bestBid = bids[0][0]
    const bestAsk = asks[0][0]
    const midPrice = (bestBid + bestAsk) / 2

    const rangeLow = midPrice * 0.98
    const rangeHigh = midPrice * 1.02

    const bidDepth2pct = bids.filter(([p]) => p >= rangeLow).reduce((sum, [_, q]) => sum + q, 0)
    const askDepth2pct = asks.filter(([p]) => p <= rangeHigh).reduce((sum, [_, q]) => sum + q, 0)
    const bidAskRatio2pct = askDepth2pct > 0 ? bidDepth2pct / askDepth2pct : 0

    // Evaluate walls
    const wallEval = evaluateWalls(bids, asks, midPrice)

    return {
        bidAskRatio2pct,
        bidDepth2pct,
        askDepth2pct,
        majorBuyWall: wallEval.buyWall,
        majorSellWall: wallEval.sellWall,
        seniorWallCheck: wallEval.interpretation,
    }
}

/**
 * Estimate liquidation levels from swing points
 */
export async function estimateLiquidations(symbol: string): Promise<LiquidationLevel[]> {
    const klines = await fetchCryptoKlines(symbol, "1d", 30)
    if (klines.length < 7) return []

    const levels: LiquidationLevel[] = []
    const recentKlines = klines.slice(-7)
    const highPrice = Math.max(...recentKlines.map((k) => k.high))
    const lowPrice = Math.min(...recentKlines.map((k) => k.low))
    const currentPrice = klines[klines.length - 1].close

    const leverages = [25, 50, 100]

    // Short liquidations (above price)
    for (const lev of leverages) {
        const liqPrice = highPrice * (1 + 1 / lev)
        const distance = Math.abs(liqPrice - currentPrice) / currentPrice

        if (distance < 0.15) {
            levels.push({
                type: "Short Liquidation",
                leverage: `${lev}x`,
                priceLevel: liqPrice,
                volumeEstimate: lev === 50 ? "High" : "Medium",
                reference: `Swing High $${highPrice.toLocaleString()}`,
            })
        }
    }

    // Long liquidations (below price)
    for (const lev of leverages) {
        const liqPrice = lowPrice * (1 - 1 / lev)
        const distance = Math.abs(liqPrice - currentPrice) / currentPrice

        if (distance < 0.15) {
            levels.push({
                type: "Long Liquidation",
                leverage: `${lev}x`,
                priceLevel: liqPrice,
                volumeEstimate: lev === 50 ? "High" : "Medium",
                reference: `Swing Low $${lowPrice.toLocaleString()}`,
            })
        }
    }

    return levels.sort((a, b) => a.priceLevel - b.priceLevel)
}

// ═══════════════════════════════════════════════════════════════════════════════
// COINGECKO & OTHER APIs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch Fear & Greed Index
 */
export async function fetchFearGreed(): Promise<FearGreedData> {
    const response = await safeFetch(FEAR_GREED_API, "default")

    if (response) {
        const data = await response.json()
        if (data.data && data.data[0]) {
            return {
                value: parseInt(data.data[0].value),
                classification: data.data[0].value_classification,
            }
        }
    }

    return { value: 50, classification: "Neutral" }
}

/**
 * Fetch trending coins from CoinGecko
 */
export async function fetchTrending(): Promise<string[]> {
    const url = `${COINGECKO_API}/search/trending`
    const response = await safeFetch(url, "coingecko")

    if (response) {
        const data = await response.json()
        return (data.coins || []).slice(0, 5).map((c: any) => c.item?.symbol?.toUpperCase() || "")
    }

    return []
}

/**
 * Fetch global market data from CoinGecko
 */
export async function fetchGlobalMarket(): Promise<GlobalMarket | null> {
    const url = `${COINGECKO_API}/global`
    const response = await safeFetch(url, "coingecko")

    if (response) {
        const data = await response.json()
        const d = data.data || {}
        return {
            totalMarketCapUsd: d.total_market_cap?.usd || 0,
            totalVolume24hUsd: d.total_volume?.usd || 0,
            btcDominance: d.market_cap_percentage?.btc || 0,
            ethDominance: d.market_cap_percentage?.eth || 0,
            activeCryptos: d.active_cryptocurrencies || 0,
        }
    }

    return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL CRYPTO DATA FETCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch all crypto data in parallel
 */
export async function fetchAllCryptoData(
    symbol: string,
    includeOrderBook: boolean = true,
    includeLiquidations: boolean = true
): Promise<{ price: PriceData; klines: OHLC[]; extras: CryptoExtras }> {
    // Parallel fetch
    const [price, klines, derivatives, orderBook, fearGreed, trending, liquidations] = await Promise.all([
        fetchCryptoPrice(symbol),
        fetchCryptoKlines(symbol, "1h", 100),
        fetchDerivatives(symbol),
        includeOrderBook ? fetchOrderBook(symbol) : Promise.resolve(null),
        fetchFearGreed(),
        fetchTrending(),
        includeLiquidations ? estimateLiquidations(symbol) : Promise.resolve([]),
    ])

    const extras: CryptoExtras = {
        fearGreed,
        trending,
    }

    if (derivatives) {
        extras.derivatives = derivatives
    }

    if (orderBook) {
        extras.orderBook = orderBook
    }

    if (liquidations.length > 0) {
        extras.liquidations = liquidations
    }

    return { price, klines, extras }
}
