import en from "../../locales/en.json"
import tr from "../../locales/tr.json"

type LocaleData = typeof en

const locales: Record<string, LocaleData> = {
  en,
  tr,
}

export namespace I18n {
  let currentLocale = "en"

  // Simple auto-detection
  if (typeof process !== "undefined") {
    const lang = process.env.ATOMCLI_LOCALE || process.env.LANG || ""
    if (lang.toLowerCase().startsWith("tr")) {
      currentLocale = "tr"
    }
  }

  export function setLocale(locale: string) {
    if (locales[locale]) {
      currentLocale = locale
    }
  }

  export function getLocale(): string {
    return currentLocale
  }

  export function t<K extends keyof LocaleData>(key: K): LocaleData[K] {
    return locales[currentLocale][key]
  }
}
