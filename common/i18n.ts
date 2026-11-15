import { assertUnreachable } from './assert-unreachable'

/**
 * A string representation of each of the languages that we support and expect to have a translation
 * file for.
 */
export enum TranslationLanguage {
  ChineseSimplified = 'zh-Hans',
  English = 'en',
  Korean = 'ko',
  Russian = 'ru',
  Spanish = 'es',
}

export const ALL_TRANSLATION_LANGUAGES: ReadonlyArray<TranslationLanguage> =
  Object.values(TranslationLanguage)

/**
 * A string representation of all the namespaces we're using for our translation files. `global`
 * holds the app's strings; `game` holds the in-game UI's strings, which live in the Rust game DLL
 * and are embedded into it at build time rather than loaded by the client.
 */
export enum TranslationNamespace {
  Global = 'global',
  Game = 'game',
}

export const ALL_TRANSLATION_NAMESPACES: ReadonlyArray<TranslationNamespace> =
  Object.values(TranslationNamespace)

/**
 * Choose the preferred language from the list of given languages. Each given language is tried in
 * order, and the first one that matches a supported language wins. A given language matches:
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
 *
 * If nothing matches, English is returned.
 */
export function getBestLanguage(
  languages: ReadonlyArray<string>,
  supportedLanguages: ReadonlyArray<string> = ALL_TRANSLATION_LANGUAGES,
): string {
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

/**
 * Maps a single locale (e.g. a user's stored `locale`, which may be a supported language like `ko`
 * or a browser-reported tag like `ko-KR` or `zh-CN`) to the supported language it should be shown
 * in, matching the way `getBestLanguage` does. A missing, empty, or unsupported locale resolves to
 * English.
 *
 * server-rs picks email languages with a port of this (`resolve_translation_language` in
 * `server-rs/src/email.rs`), so the two must agree: their unit tests share the same cases.
 */
export function resolveTranslationLanguage(locale: string | null | undefined): TranslationLanguage {
  return locale
    ? (getBestLanguage([locale], ALL_TRANSLATION_LANGUAGES) as TranslationLanguage)
    : TranslationLanguage.English
}

export function translationLanguageToLabel(language: TranslationLanguage) {
  switch (language) {
    case TranslationLanguage.ChineseSimplified:
      return '简体中文'
    case TranslationLanguage.English:
      return 'English'
    case TranslationLanguage.Korean:
      return '한국어'
    case TranslationLanguage.Russian:
      return 'Русский'
    case TranslationLanguage.Spanish:
      return 'Español'
    default:
      return assertUnreachable(language)
  }
}
