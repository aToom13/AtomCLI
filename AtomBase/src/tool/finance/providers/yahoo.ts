/**
 * Finance Analyze Tool - Yahoo Finance Provider
 *
 * Fetches data for stocks, ETFs, commodities, forex, and indices.
 * Uses public Yahoo Finance endpoints (no API key required).
 */

import type { PriceData, OHLC, StockExtras, AssetType } from "../types"

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

export const YAHOO_CHART_API = "https://query1.finance.yahoo.com/v8/finance/chart"
export const YAHOO_QUOTE_API = "https://query1.finance.yahoo.com/v7/finance/quote"

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

let lastYahooCall = 0
const YAHOO_MIN_INTERVAL = 500 // Min 500ms between calls

async function waitForYahooRateLimit(): Promise<void> {
    const now = Date.now()
    const elapsed = now - lastYahooCall
    if (elapsed < YAHOO_MIN_INTERVAL) {
        await new Promise((resolve) => setTimeout(resolve, YAHOO_MIN_INTERVAL - elapsed))
    }
    lastYahooCall = Date.now()
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function yahooFetch(url: string): Promise<any | null> {
    await waitForYahooRateLimit()

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Accept: "application/json",
            },
        })

        if (!response.ok) {
            console.error(`Yahoo Finance HTTP ${response.status} for ${url}`)
            return null
        }

        return await response.json()
    } catch (error) {
        console.error(`Yahoo Finance fetch error:`, error)
        return null
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE DATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch price and basic info from Yahoo Finance Chart API
 * Note: Quote API now requires auth, but Chart API still works
 */
export async function fetchYahooPrice(symbol: string, assetType: AssetType): Promise<PriceData> {
    // Use Chart API instead of Quote API (Quote API now requires auth)
    const url = `${YAHOO_CHART_API}/${symbol}?range=1d&interval=1d`
    const data = await yahooFetch(url)

    if (!data || !data.chart?.result?.[0]) {
        throw new Error(`Failed to fetch Yahoo data for ${symbol}`)
    }

    const result = data.chart.result[0]
    const meta = result.meta || {}
    const quote = result.indicators?.quote?.[0] || {}

    // Get latest values
    const timestamps = result.timestamp || []
    const lastIdx = timestamps.length - 1
    const currentPrice = meta.regularMarketPrice || (lastIdx >= 0 ? quote.close?.[lastIdx] : 0) || 0
    const previousClose = meta.previousClose || meta.chartPreviousClose || currentPrice
    const change24h = currentPrice - previousClose
    const changePercent24h = previousClose > 0 ? (change24h / previousClose) * 100 : 0

    return {
        symbol: meta.symbol || symbol,
        name: meta.shortName || meta.longName || symbol,
        assetType,
        price: currentPrice,
        change24h,
        changePercent24h,
        volume24h: meta.regularMarketVolume || (lastIdx >= 0 ? quote.volume?.[lastIdx] : 0) || 0,
        high24h: meta.regularMarketDayHigh || (lastIdx >= 0 ? quote.high?.[lastIdx] : 0) || 0,
        low24h: meta.regularMarketDayLow || (lastIdx >= 0 ? quote.low?.[lastIdx] : 0) || 0,
        open: lastIdx >= 0 ? quote.open?.[lastIdx] : 0,
        previousClose,
        marketCap: undefined, // Chart API doesn't provide market cap
        currency: meta.currency || "USD",
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORICAL DATA (OHLC)
// ═══════════════════════════════════════════════════════════════════════════════

type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y"
type YahooInterval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk"

/**
 * Fetch historical OHLC data from Yahoo Finance
 */
export async function fetchYahooKlines(
    symbol: string,
    range: YahooRange = "1mo",
    interval: YahooInterval = "1d"
): Promise<OHLC[]> {
    // Don't encode symbols - Yahoo Finance expects raw symbols
    const url = `${YAHOO_CHART_API}/${symbol}?range=${range}&interval=${interval}`
    const data = await yahooFetch(url)

    if (!data || !data.chart?.result?.[0]) {
        return []
    }

    const result = data.chart.result[0]
    const timestamps = result.timestamp || []
    const quote = result.indicators?.quote?.[0] || {}

    const ohlcData: OHLC[] = []

    for (let i = 0; i < timestamps.length; i++) {
        const open = quote.open?.[i]
        const high = quote.high?.[i]
        const low = quote.low?.[i]
        const close = quote.close?.[i]
        const volume = quote.volume?.[i]

        // Skip if any value is null
        if (open == null || high == null || low == null || close == null) {
            continue
        }

        ohlcData.push({
            timestamp: new Date(timestamps[i] * 1000),
            open,
            high,
            low,
            close,
            volume: volume || 0,
        })
    }

    return ohlcData
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK DETAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch additional stock details (P/E, EPS, etc.)
 */
export async function fetchStockDetails(symbol: string): Promise<StockExtras | null> {
    const url = `${YAHOO_QUOTE_API}?symbols=${symbol}`
    const data = await yahooFetch(url)

    if (!data || !data.quoteResponse?.result?.[0]) {
        return null
    }

    const quote = data.quoteResponse.result[0]

    return {
        pe: quote.trailingPE || quote.forwardPE,
        eps: quote.epsTrailingTwelveMonths,
        dividendYield: quote.dividendYield ? quote.dividendYield * 100 : undefined,
        beta: quote.beta,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
        avgVolume: quote.averageVolume || 0,
        sector: quote.sector,
        industry: quote.industry,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL YAHOO DATA FETCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch all Yahoo Finance data for a symbol
 */
export async function fetchAllYahooData(
    symbol: string,
    assetType: AssetType,
    detailed: boolean = true
): Promise<{ price: PriceData; klines: OHLC[]; extras: StockExtras | null }> {
    // Fetch price and klines in parallel
    const [price, klines] = await Promise.all([
        fetchYahooPrice(symbol, assetType),
        fetchYahooKlines(symbol, "1mo", "1d"),
    ])

    // Fetch stock details if it's a stock/ETF and detailed=true
    let extras: StockExtras | null = null
    if (detailed && (assetType === "stock" || assetType === "etf")) {
        extras = await fetchStockDetails(symbol)
    }

    return { price, klines, extras }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMODITY NAME MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const COMMODITY_NAMES: Record<string, string> = {
    "CL=F": "Crude Oil (WTI)",
    "BZ=F": "Brent Crude",
    "NG=F": "Natural Gas",
    "GC=F": "Gold",
    "SI=F": "Silver",
    "PL=F": "Platinum",
    "PA=F": "Palladium",
    "HG=F": "Copper",
    "ZW=F": "Wheat",
    "ZC=F": "Corn",
    "ZS=F": "Soybeans",
    "KC=F": "Coffee",
    "CT=F": "Cotton",
}

/**
 * Get friendly name for commodity ticker
 */
export function getCommodityName(ticker: string): string {
    return COMMODITY_NAMES[ticker] || ticker
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX NAME MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const INDEX_NAMES: Record<string, string> = {
    "^GSPC": "S&P 500",
    "^IXIC": "NASDAQ Composite",
    "^NDX": "NASDAQ 100",
    "^DJI": "Dow Jones",
    "^RUT": "Russell 2000",
    "^VIX": "VIX (Volatility Index)",
    "DX-Y.NYB": "US Dollar Index (DXY)",
    "^GDAXI": "DAX (Germany)",
    "^FTSE": "FTSE 100 (UK)",
    "^N225": "Nikkei 225 (Japan)",
    "^HSI": "Hang Seng (Hong Kong)",
    "XU100.IS": "BIST 100 (Turkey)",
}

/**
 * Get friendly name for index ticker
 */
export function getIndexName(ticker: string): string {
    return INDEX_NAMES[ticker] || ticker
}
