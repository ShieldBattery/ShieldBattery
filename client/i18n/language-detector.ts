import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../common/i18n'

const lowerCaseSupportedLanguages = ALL_TRANSLATION_LANGUAGES.map(l => l.toLowerCase())

/**
 * Choose the preferred language from the list of given languages. If no languages are given, we
 * default to using `navigator.languages` as a list of available languages. The logic for choosing
 * the preferred language is:
 *  - for languages we support without dialects, prefer the earliest matching language in the list
 *    of given languages.
 *  - for languages we support with dialects, prefer only if exact match.
 */
export function getBestLanguage(languages = navigator.languages) {
  for (let i = 0; i < languages.length; i++) {
    const lng = languages[i].toLowerCase() as TranslationLanguage

    let lngIndex = lowerCaseSupportedLanguages.indexOf(lng)
    if (lngIndex > -1) {
      return ALL_TRANSLATION_LANGUAGES[lngIndex]
    }

    const lngWithoutDialect = lng.split('-')[0]

    lngIndex = lowerCaseSupportedLanguages.indexOf(lngWithoutDialect)
    if (lngIndex > -1) {
      return ALL_TRANSLATION_LANGUAGES[lngIndex]
    }
  }

  return TranslationLanguage.English
}
