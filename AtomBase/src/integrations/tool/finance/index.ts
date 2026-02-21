/**
 * Finance Analyze Tool
 * 
 * Comprehensive multi-asset financial analysis tool with hybrid AI orchestration.
 */

import { Tool } from "../tool"
import { z } from "zod"
import {
    fetchYahooPrice,
    fetchYahooKlines,
    fetchStockDetails,
    YAHOO_QUOTE_API,
    YAHOO_CHART_API,
} from "./providers/yahoo"
import { fetchAllCryptoData } from "./providers/crypto"
import { applySeniorLogic } from "./logic"
import { analyzeKlines } from "./technical"
import { detectAssetType, getAssetTypeEmoji, getAssetTypeName } from "./symbols"
import type { FinanceAnalysis, AssetType } from "./types"
import { getGenerateText } from "@/util/util/ai-compat"
import { Provider } from "../../provider/provider"
import { Log } from "@/util/util/log"
import DESCRIPTION from "./finance.txt"

// Prompts
// @ts-ignore
import RISK_PROMPT from "./prompts/risk_analyst.txt"
// @ts-ignore
import STRATEGY_PROMPT from "./prompts/strategy_analyst.txt"
// @ts-ignore
import COORDINATOR_PROMPT from "./prompts/coordinator.txt"

const log = Log.create({ service: "finance" })

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

export const FinanceAnalyzeTool = Tool.define("finance_analyze", {
    description: DESCRIPTION,
    parameters: z.object({
        symbol: z.string().describe("Varlık sembolü (örn: BTC, AAPL, OIL, EURUSD, SPX, ALTIN)"),
        type: z
            .enum(["crypto", "stock", "etf", "commodity", "forex", "index"] as const)
            .optional()
            .describe("Varlık tipi (otomatik algılanır)"),
        detailed: z.boolean().optional().default(true).describe("Detaylı analiz (derivatives, orderbook, P/E)"),
    }),

    async execute(params, ctx) {
        log.info("Starting hybrid analysis", { symbol: params.symbol })

        // 1. Detect Asset Type
        const detected = detectAssetType(params.symbol, params.type as AssetType | undefined)
        const { type: assetType, ticker } = detected

        let analysis: FinanceAnalysis
        let priceData: any
        let technicalData: any
        let klinesData: any
        let cryptoExtras: any
        let stockExtras: any

        try {
            if (assetType === "crypto") {
                // Fetch Crypto Data
                const cryptoData = await fetchAllCryptoData(ticker)
                if (!cryptoData) throw new Error(`Data not found for ${ticker}`)

                priceData = cryptoData.price
                klinesData = cryptoData.klines
                cryptoExtras = {
                    derivatives: cryptoData.extras.derivatives,
                    orderBook: cryptoData.extras.orderBook,
                    fearGreed: cryptoData.extras.fearGreed,
                    liquidations: cryptoData.extras.liquidations
                }

                technicalData = analyzeKlines(klinesData)
            } else {
                // Fetch Yahoo Data
                priceData = await fetchYahooPrice(ticker, assetType)
                if (!priceData) throw new Error(`Price data not found for ${ticker}`)

                klinesData = await fetchYahooKlines(ticker)
                technicalData = analyzeKlines(klinesData)

                if (assetType === "stock" || assetType === "etf") {
                    stockExtras = await fetchStockDetails(ticker)
                }
            }

            // Senior Logic
            const seniorChecks = applySeniorLogic(
                technicalData,
                cryptoExtras?.derivatives,
                priceData?.changePercent24h
            )

            // Assemble Analysis Object
            analysis = {
                symbol: params.symbol,
                ticker: ticker,
                assetType: assetType,
                timestamp: new Date().toISOString(),
                price: priceData,
                technical: technicalData,
                klines: klinesData,
                crypto: cryptoExtras,
                stock: stockExtras,
                seniorChecks: seniorChecks
            }

            // 2. Prepare Context
            const dataContext = prepareDataContext(analysis, seniorChecks)

            // 3. Run Parallel Analysis (Risk & Strategy)
            log.info("Running parallel analysis agents...")

            // Use specific models as requested: Risk (Minimax), Strategy (DeepSeek)
            const [riskReport, strategyReport] = await Promise.all([
                runAnalysis("Risk Analyst", ["minimax-m2.1", "minimax-m2.1-free"], RISK_PROMPT as string, dataContext),
                runAnalysis("Strategy Analyst", ["deepseek-v3.2", "deepseek-v3"], STRATEGY_PROMPT as string, dataContext)
            ])

            // 4. Run Coordinator Analysis
            log.info("Running coordinator agent...")

            const coordinatorContext = `
# RISK ANALYST REPORT
${riskReport}

# STRATEGY ANALYST REPORT
${strategyReport}

# MARKET DATA
${dataContext}
            `

            // Coordinator: Gemini 3 Pro Preview (fallback to 1.5 Pro)
            const finalReport = await runAnalysis(
                "Coordinator",
                ["gemini-3-pro-preview", "gemini-1.5-pro-preview", "gemini-1.5-pro", "gpt-4o"],
                COORDINATOR_PROMPT as string,
                coordinatorContext
            )

            return {
                title: "Hybrid Finance Analysis",
                metadata: {},
                output: finalReport
            }

        } catch (error) {
            log.error("Analysis failed", { error })
            return {
                title: "Finance Analysis Failed",
                metadata: {},
                output: `Analiz sırasında hata oluştu: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`
            }
        }
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
// HYBRID ANALYSIS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Public fallback models (atomcli provider - no API key needed)
 * These are used when preferred models (ollama, claude) are unavailable
 */
const PUBLIC_FALLBACK_MODELS = [
    // Risk Analyst fallbacks
    "minimax-m2.1-free",
    "glm-4.7-free",
    // Strategy Analyst fallbacks
    "deepseek-v3",
    "big-pickle",
    // Coordinator fallbacks
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gpt-4o-mini"
]

async function resolveModel(preferredIds: string[]) {
    try {
        const providers = await Provider.list()
        const allModels = Object.values(providers).flatMap(p => Object.values(p.models))

        // First, try preferred models
        for (const id of preferredIds) {
            const model = allModels.find(m => m.id === id || m.id.includes(id))
            if (model) {
                log.info("Resolved model", { preferred: id, found: model.id })
                return model
            }
        }

        log.warn("Preferred models not found, trying public fallbacks...", { preferred: preferredIds })

        // Second, try public fallback models (atomcli provider)
        for (const fallbackId of PUBLIC_FALLBACK_MODELS) {
            const model = allModels.find(m =>
                m.id === fallbackId ||
                m.id.includes(fallbackId) ||
                (m.providerID === "atomcli" && m.id.includes(fallbackId.replace("-free", "")))
            )
            if (model) {
                log.info("Using public fallback model", { model: model.id, provider: model.providerID })
                return model
            }
        }

        // Third, try any available gemini or gpt model
        const anyGemini = allModels.find(m => m.id.includes("gemini"))
        if (anyGemini) {
            log.info("Using any available Gemini model", { model: anyGemini.id })
            return anyGemini
        }

        const anyGpt = allModels.find(m => m.id.includes("gpt"))
        if (anyGpt) {
            log.info("Using any available GPT model", { model: anyGpt.id })
            return anyGpt
        }

        // Last resort: first available model
        if (allModels.length > 0) {
            log.warn("Using first available model as last resort", { model: allModels[0].id })
            return allModels[0]
        }

        return undefined
    } catch (error) {
        log.error("Failed to resolve model", { error })
        return undefined
    }
}

async function runAnalysis(role: string, preferredModels: string[], systemPrompt: string, userContent: string): Promise<string> {
    try {
        const model = await resolveModel(preferredModels)
        if (!model) throw new Error(`Model not found for ${role}`)

        const languageModel = await Provider.getLanguage(model)

        log.info(`Running ${role} analysis`, { model: model.id })

        const generateText = await getGenerateText()
        const { text } = await generateText({
            model: languageModel,
            system: systemPrompt,
            messages: [
                { role: "user", content: userContent }
            ]
        })

        return text
    } catch (error) {
        log.error(`Analysis failed for ${role}`, { error })
        return `[${role} Analizi Başarısız Oldu: ${error instanceof Error ? error.message : "Bilinmeyen Hata"}]`
    }
}

function prepareDataContext(analysis: FinanceAnalysis, seniorChecks: any): string {
    const price = analysis.price
    const technical = analysis.technical
    const crypto = analysis.crypto

    return JSON.stringify({
        symbol: analysis.symbol,
        ticker: analysis.ticker,
        assetType: analysis.assetType,
        timestamp: analysis.timestamp,
        price: {
            current: price.price,
            change24h: price.changePercent24h,
            volume24h: price.volume24h,
            high24h: price.high24h,
            low24h: price.low24h,
        },
        technical: {
            rsi: technical.rsi,
            rsiSignal: technical.rsiSignal,
            macdTrend: technical.macdTrend,
            bbSignal: technical.bbSignal,
            trend: technical.trend,
            volumeTrend: technical.volumeTrend,
            sma20: technical.sma20,
            sma50: technical.sma50,
            sma200: technical.sma200,
            vwap: technical.vwap,
        },
        derivatives: crypto?.derivatives ? {
            openInterestUsd: crypto.derivatives.openInterestUsd,
            fundingRate: crypto.derivatives.fundingRate,
            longShortRatio: crypto.derivatives.longShortRatio,
        } : undefined,
        fearGreed: crypto?.fearGreed,
        riskScore: seniorChecks.riskScore,
        warnings: seniorChecks.warnings,
        signals: seniorChecks.signals,
    }, null, 2)
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export { FinanceAnalyzeTool as default }
export * from "./types"
export * from "./symbols"
export * from "./technical"
export * from "./logic"
