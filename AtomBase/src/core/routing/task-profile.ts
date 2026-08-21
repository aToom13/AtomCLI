import type { Provider } from "@/integrations/provider/provider"

export namespace TaskProfile {
  export type Category = "coding" | "documentation" | "analysis" | "general"
  export type Risk = "low" | "medium" | "high"
  export type Priority = "speed" | "balanced" | "quality"

  export interface Info {
    category: Category
    complexity: number
    risk: Risk
    priority: Priority
    needsTools: boolean
    needsBrowser: boolean
    needsVision: boolean
    needsPlanning: boolean
    longContext: boolean
    readOnly: boolean
  }

  const has = (text: string, pattern: RegExp) => pattern.test(text)

  function withoutNegativeMutation(text: string) {
    return text.replace(/\b(?:do not|don't|never)\s+(?:change|edit|modify|write)\b|değiştirme|düzenleme|yazma/g, "")
  }

  function inferCategory(text: string): Category {
    const readOnlyIntent =
      /\b(analyze|review|audit|inspect|compare|benchmark|explain|read[- ]?only)\b|analiz|incele|karşılaştır|açıkla|değiştirme/.test(
        text,
      )
    const mutationIntent =
      /\b(implement|fix|refactor|debug|build|write|edit)\b|düzelt|uygula|değiştir|ekle|kaldır/.test(
        withoutNegativeMutation(text),
      )
    if (readOnlyIntent && !mutationIntent) return "analysis"
    if (/\b(implement|fix|refactor|debug|code|test|build)\b|düzelt|uygula|kod|hata/.test(text)) return "coding"
    if (/\b(document|readme|guide|tutorial|changelog)\b|doküman|belge|rehber/.test(text)) return "documentation"
    if (/\b(analyze|review|audit|inspect|compare|benchmark)\b|analiz|incele|karşılaştır/.test(text)) return "analysis"
    return "general"
  }

  export function infer(prompt: string, category?: Category): Info {
    const text = prompt.toLowerCase()
    category ??= inferCategory(text)
    const words = text.split(/\s+/).filter(Boolean).length
    const readOnly =
      has(text, /\b(incele|analiz|audit|review|explain|açıkla|değiştirme|read[- ]?only)\b/) &&
      !has(withoutNegativeMutation(text), /\b(düzelt|değiştir|uygula|implement|fix|write|edit|refactor|ekle|kaldır)\b/)
    const needsBrowser = has(
      text,
      /\b(browser|playwright|web ui|website|web search|search online|latest|current|news|weather|price|sayfa|tarayıcı|internette ara|güncel|haber|hava durumu|fiyat|dom|accessibility)\b/,
    )
    const needsVision = has(text, /\b(image|screenshot|görsel|ekran görüntüsü|vision|pdf)\b/)
    const needsPlanning =
      words > 120 ||
      has(text, /\b(multi[- ]?step|migrate|migration|architecture|monorepo)\b|kapsamlı|mimari|tüm|hepsini/)
    const longContext = words > 300 || has(text, /\b(whole repo|entire repo|codebase|monorepo)\b|tüm proje|bütün proje/)
    const repositoryInspection =
      readOnly &&
      has(
        text,
        /\b(code|codebase|repo|repository|file|test|provider|auth|implementation)\b|kod|dosya|test|sağlayıcı|uygulama/,
      )
    const highRisk = has(
      text,
      /\b(auth|security|permission|credential|secret|migration|release|payment)\b|güvenlik|kimlik|yetki/,
    )
    const mediumRisk = category === "coding" || has(text, /\b(api|schema|database|route|config|dependency)\b/)
    const priority: Priority = has(text, /\b(fast|quick|hızlı|çabuk)\b/)
      ? "speed"
      : has(text, /\b(best|quality|doğru|kapsamlı|thorough|yüksek kalite)\b/)
        ? "quality"
        : "balanced"
    let complexity = Math.min(10, words / 80)
    if (needsPlanning) complexity += 2
    if (needsBrowser || needsVision) complexity += 1
    if (highRisk) complexity += 2
    if (/```/.test(prompt)) complexity += 1

    return {
      category,
      complexity: Math.min(10, complexity),
      risk: highRisk ? "high" : mediumRisk ? "medium" : "low",
      priority,
      needsTools:
        category === "coding" ||
        needsBrowser ||
        repositoryInspection ||
        has(text, /\b(run|test|command|terminal|araç|komut)\b/),
      needsBrowser,
      needsVision,
      needsPlanning,
      longContext,
      readOnly,
    }
  }

  export function modelBonus(profile: Info, model: Provider.Model): number {
    if (profile.needsTools && !model.capabilities.toolcall) return -1_000
    if (profile.needsVision && !model.capabilities.input.image) return -1_000
    let score = 0
    if ((profile.needsPlanning || profile.risk === "high") && model.capabilities.reasoning) score += 35
    if (profile.needsBrowser && model.capabilities.toolcall) score += 20
    if (profile.longContext) score += Math.min((model.limit?.context ?? 0) / 8_000, 30)
    if (profile.priority === "speed" && !model.capabilities.reasoning) score += 15
    if (profile.priority === "quality" && model.capabilities.reasoning) score += 20
    return score
  }
}
