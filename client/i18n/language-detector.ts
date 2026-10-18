import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../common/i18n'

/**
 * Choose the preferred language from the list of given languages. If no languages are given, we
 * default to using `navigator.languages` as a list of available languages. Each given language is
 * tried in order, and the first one that matches a supported language wins. A given language
 * matches:
 *  - a supported language with the exact same tag,
 *  - a supported language that names its script (e.g. `zh-Hans`), if the given language is written
 *    in that script. Browsers report regions rather than scripts (`zh-CN`, or plain `zh`), so the
 *    script is inferred from CLDR's likely subtags: `zh-CN` is written in Simplified characters,
 *    while `zh-TW` and `zh-HK` are written in Traditional ones and don't match `zh-Hans`.
 *  - a supported language that is just the given language without its region (`es-MX` -> `es`).
 *
 * A bare language (`zh`) takes its script from an earlier entry for the same language, if there is
 * one. Browsers append the bare form after a regional preference (`zh-TW, zh, en-US, en`), and
 * there it means the same Traditional Chinese, not CLDR's default of Simplified.
 */
export function getBestLanguage(
  languages = navigator.languages,
  supportedLanguages: string[] = ALL_TRANSLATION_LANGUAGES as string[],
) {
  const lowerCaseSupportedLanguages = supportedLanguages.map(l => l.toLowerCase())
  /** The script of the first entry seen for each language, keyed by lowercase language. */
  const scriptByLanguage = new Map<string, string>()

  for (const lng of languages) {
    for (const candidate of candidatesFor(lng, scriptByLanguage)) {
      const lngIndex = lowerCaseSupportedLanguages.indexOf(candidate)
      if (lngIndex > -1) {
        return supportedLanguages[lngIndex]
      }
    }
  }

  return TranslationLanguage.English
}

/**
 * The lowercase tags a given language could match, most specific first. Records the language's
 * script in `scriptByLanguage` for later bare entries of the same language.
 */
function candidatesFor(lng: string, scriptByLanguage: Map<string, string>): string[] {
  const lowerCaseLanguage = lng.toLowerCase()
  let locale: Intl.Locale
  try {
    locale = new Intl.Locale(lng)
  } catch {
    // Not a valid BCP 47 tag, so there's no script to infer
    return [lowerCaseLanguage, lowerCaseLanguage.split('-', 1)[0]]
  }

  const language = locale.language.toLowerCase()
  const isBare = !locale.script && !locale.region
  const script = (isBare && scriptByLanguage.get(language)) || (locale.maximize().script ?? '')
  if (!scriptByLanguage.has(language)) {
    scriptByLanguage.set(language, script)
  }

  return [lowerCaseLanguage, `${language}-${script}`.toLowerCase(), language]
}
