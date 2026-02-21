/**
 * Finance Analyze Tool - Symbol Mapping
 *
 * Maps user-friendly symbols to actual tickers and detects asset types.
 */

import type { AssetType } from "./types"

// ═══════════════════════════════════════════════════════════════════════════════
// COMMODITY MAPPING (Yahoo Finance Futures)
// ═══════════════════════════════════════════════════════════════════════════════

const COMMODITY_MAP: Record<string, string> = {
    // Oil
    OIL: "CL=F",
    PETROL: "CL=F",
    CRUDE: "CL=F",
    WTI: "CL=F",
    BRENT: "BZ=F",

    // Natural Gas
    GAS: "NG=F",
    DOGALGAZ: "NG=F",
    NATURAL_GAS: "NG=F",
    NATURALGAS: "NG=F",

    // Precious Metals
    GOLD: "GC=F",
    ALTIN: "GC=F",
    XAU: "GC=F",
    SILVER: "SI=F",
    GUMUS: "SI=F",
    XAG: "SI=F",
    PLATINUM: "PL=F",
    PALLADIUM: "PA=F",

    // Base Metals
    COPPER: "HG=F",
    BAKIR: "HG=F",

    // Agricultural
    WHEAT: "ZW=F",
    BUGDAY: "ZW=F",
    CORN: "ZC=F",
    MISIR: "ZC=F",
    SOYBEAN: "ZS=F",
    COFFEE: "KC=F",
    KAHVE: "KC=F",
    COTTON: "CT=F",
    PAMUK: "CT=F",
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const INDEX_MAP: Record<string, string> = {
    // US Indices
    SPX: "^GSPC",
    SP500: "^GSPC",
    "S&P500": "^GSPC",
    "S&P": "^GSPC",
    NASDAQ: "^IXIC",
    NDX: "^NDX",
    NASDAQ100: "^NDX",
    DOW: "^DJI",
    DJIA: "^DJI",
    DOWJONES: "^DJI",
    RUSSELL: "^RUT",
    RUSSELL2000: "^RUT",

    // Volatility
    VIX: "^VIX",

    // Dollar Index
    DXY: "DX-Y.NYB",
    DOLAR: "DX-Y.NYB",
    DOLLAR: "DX-Y.NYB",
    DOLLARINDEX: "DX-Y.NYB",

    // European
    DAX: "^GDAXI",
    FTSE: "^FTSE",
    CAC: "^FCHI",
    STOXX: "^STOXX50E",

    // Asian
    NIKKEI: "^N225",
    HANGSENG: "^HSI",
    HSI: "^HSI",
    SHANGHAI: "000001.SS",

    // Turkey
    BIST: "XU100.IS",
    BIST100: "XU100.IS",
    XU100: "XU100.IS",
    BIST30: "XU030.IS",
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOREX MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const FOREX_MAP: Record<string, string> = {
    EURUSD: "EURUSD=X",
    GBPUSD: "GBPUSD=X",
    USDJPY: "USDJPY=X",
    USDCHF: "USDCHF=X",
    AUDUSD: "AUDUSD=X",
    USDCAD: "USDCAD=X",
    NZDUSD: "NZDUSD=X",
    USDTRY: "USDTRY=X",
    EURTRY: "EURTRY=X",
    GBPTRY: "GBPTRY=X",
    EURJPY: "EURJPY=X",
    GBPJPY: "GBPJPY=X",
    XAUUSD: "GC=F", // Gold is actually a commodity
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRYPTOCURRENCY LIST (Route to Binance)
// ═══════════════════════════════════════════════════════════════════════════════

const CRYPTO_SYMBOLS = new Set([
    "BTC",
    "ETH",
    "BNB",
    "XRP",
    "ADA",
    "SOL",
    "DOGE",
    "DOT",
    "AVAX",
    "MATIC",
    "LINK",
    "UNI",
    "ATOM",
    "LTC",
    "ETC",
    "XLM",
    "NEAR",
    "APT",
    "ARB",
    "OP",
    "INJ",
    "FIL",
    "HBAR",
    "VET",
    "ALGO",
    "FTM",
    "SAND",
    "MANA",
    "AXS",
    "THETA",
    "ICP",
    "TRX",
    "XMR",
    "BCH",
    "NEO",
    "EOS",
    "AAVE",
    "MKR",
    "CRV",
    "SNX",
    "COMP",
    "SUSHI",
    "YFI",
    "1INCH",
    "GRT",
    "RENDER",
    "FET",
    "AGIX",
    "WLD",
    "SUI",
    "SEI",
    "TIA",
    "JUP",
    "PYTH",
    "JTO",
    "BONK",
    "WIF",
    "PEPE",
    "SHIB",
    "FLOKI",
])

// ═══════════════════════════════════════════════════════════════════════════════
// POPULAR STOCKS (for type detection)
// ═══════════════════════════════════════════════════════════════════════════════

const STOCK_SYMBOLS = new Set([
    // Tech Giants
    "AAPL",
    "MSFT",
    "GOOGL",
    "GOOG",
    "AMZN",
    "META",
    "NVDA",
    "TSLA",
    "AMD",
    "INTC",
    "ORCL",
    "CRM",
    "ADBE",
    "NFLX",
    "PYPL",
    // Finance
    "JPM",
    "BAC",
    "WFC",
    "GS",
    "MS",
    "V",
    "MA",
    // Healthcare
    "JNJ",
    "UNH",
    "PFE",
    "ABBV",
    "MRK",
    // Consumer
    "WMT",
    "PG",
    "KO",
    "PEP",
    "MCD",
    "NKE",
    "DIS",
    // Energy
    "XOM",
    "CVX",
    // Industrial
    "BA",
    "CAT",
    "GE",
    "MMM",
    // Crypto related stocks
    "COIN",
    "MSTR",
    "MARA",
    "RIOT",
])

// ═══════════════════════════════════════════════════════════════════════════════
// ETF LIST
// ═══════════════════════════════════════════════════════════════════════════════

const ETF_SYMBOLS = new Set([
    // Major ETFs
    "SPY",
    "QQQ",
    "IWM",
    "DIA",
    "VOO",
    "VTI",
    "VEA",
    "VWO",
    "EFA",
    "EEM",
    // Sector ETFs
    "XLF",
    "XLK",
    "XLE",
    "XLV",
    "XLI",
    "XLP",
    "XLY",
    "XLU",
    "XLB",
    "XLRE",
    // Bond ETFs
    "TLT",
    "IEF",
    "SHY",
    "LQD",
    "HYG",
    "BND",
    "AGG",
    // Commodity ETFs
    "GLD",
    "SLV",
    "USO",
    "UNG",
    // Bitcoin ETFs
    "IBIT",
    "FBTC",
    "ARKB",
    "BITB",
    "GBTC",
    // Leveraged
    "TQQQ",
    "SQQQ",
    "SPXL",
    "SPXS",
])

// ═══════════════════════════════════════════════════════════════════════════════
// DETECTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface DetectedAsset {
    type: AssetType
    ticker: string
    originalSymbol: string
}

/**
 * Detects asset type and maps symbol to the correct ticker
 */
export function detectAssetType(symbol: string, hintType?: AssetType): DetectedAsset {
    const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z0-9=\-^.]/g, "")

    // If user provided a hint, use it
    if (hintType) {
        return {
            type: hintType,
            ticker: mapSymbolByType(normalizedSymbol, hintType),
            originalSymbol: symbol,
        }
    }

    // Check if it's already a Yahoo Finance ticker format
    if (normalizedSymbol.includes("=") || normalizedSymbol.startsWith("^") || normalizedSymbol.includes(".")) {
        // Determine type from ticker format
        if (normalizedSymbol.endsWith("=X")) {
            return { type: "forex", ticker: normalizedSymbol, originalSymbol: symbol }
        }
        if (normalizedSymbol.endsWith("=F")) {
            return { type: "commodity", ticker: normalizedSymbol, originalSymbol: symbol }
        }
        if (normalizedSymbol.startsWith("^")) {
            return { type: "index", ticker: normalizedSymbol, originalSymbol: symbol }
        }
        // Stock with exchange suffix (e.g., XU100.IS)
        return { type: "stock", ticker: normalizedSymbol, originalSymbol: symbol }
    }

    // Check mappings in order
    if (COMMODITY_MAP[normalizedSymbol]) {
        return {
            type: "commodity",
            ticker: COMMODITY_MAP[normalizedSymbol],
            originalSymbol: symbol,
        }
    }

    if (INDEX_MAP[normalizedSymbol]) {
        return {
            type: "index",
            ticker: INDEX_MAP[normalizedSymbol],
            originalSymbol: symbol,
        }
    }

    if (FOREX_MAP[normalizedSymbol]) {
        return {
            type: "forex",
            ticker: FOREX_MAP[normalizedSymbol],
            originalSymbol: symbol,
        }
    }

    if (CRYPTO_SYMBOLS.has(normalizedSymbol)) {
        return {
            type: "crypto",
            ticker: normalizedSymbol + "USDT",
            originalSymbol: symbol,
        }
    }

    // Check for Crypto pairs (e.g. BTC-USD, BTCUSD, ETH/USDT)
    // Strip common suffixes and delimiters
    const cleanCrypto = normalizedSymbol.replace(/[-_/]?(USD|USDT|USDC|BUSD|EUR|TRY)$/, "")
    if (CRYPTO_SYMBOLS.has(cleanCrypto)) {
        return {
            type: "crypto",
            ticker: cleanCrypto + "USDT",
            originalSymbol: symbol,
        }
    }

    if (ETF_SYMBOLS.has(normalizedSymbol)) {
        return {
            type: "etf",
            ticker: normalizedSymbol,
            originalSymbol: symbol,
        }
    }

    if (STOCK_SYMBOLS.has(normalizedSymbol)) {
        return {
            type: "stock",
            ticker: normalizedSymbol,
            originalSymbol: symbol,
        }
    }

    // Default: assume it's a stock symbol
    return {
        type: "stock",
        ticker: normalizedSymbol,
        originalSymbol: symbol,
    }
}

/**
 * Maps symbol to ticker for a specific asset type
 */
function mapSymbolByType(symbol: string, type: AssetType): string {
    switch (type) {
        case "crypto":
            return symbol.endsWith("USDT") ? symbol : symbol + "USDT"
        case "commodity":
            return COMMODITY_MAP[symbol] || symbol
        case "index":
            return INDEX_MAP[symbol] || symbol
        case "forex":
            return FOREX_MAP[symbol] || (symbol + "=X")
        case "stock":
        case "etf":
        default:
            return symbol
    }
}

/**
 * Get display name for asset type
 */
export function getAssetTypeEmoji(type: AssetType): string {
    const emojis: Record<AssetType, string> = {
        crypto: "🪙",
        stock: "📈",
        etf: "📊",
        commodity: "🛢️",
        forex: "💱",
        index: "📉",
    }
    return emojis[type] || "📊"
}

/**
 * Get display name for asset type in Turkish
 */
export function getAssetTypeName(type: AssetType): string {
    const names: Record<AssetType, string> = {
        crypto: "Kripto Para",
        stock: "Hisse Senedi",
        etf: "ETF",
        commodity: "Emtia",
        forex: "Döviz",
        index: "Endeks",
    }
    return names[type] || "Varlık"
}
