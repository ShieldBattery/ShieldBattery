import { assertUnreachable } from './assert-unreachable'

/**
 * A string representation of each of the languages that we support and expect to have a translation
 * file for.
 */
export enum TranslationLanguage {
  ChineseSimplified = 'zh-Hans',
  English = 'en',
  Korean = 'kr',
  Russian = 'ru',
  Spanish = 'es',
}

export const ALL_TRANSLATION_LANGUAGES: ReadonlyArray<TranslationLanguage> =
  Object.values(TranslationLanguage)

/**
 * A string representation of all the namespaces we're using for our translation files. Currently
 * we're not using different namespaces so we just define a default one.
 */
export enum TranslationNamespace {
  Global = 'global',
}

export const ALL_TRANSLATION_NAMESPACES: ReadonlyArray<TranslationNamespace> =
  Object.values(TranslationNamespace)

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
