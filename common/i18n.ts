/**
 * A string representation of each of the languages that we support and expect to have a translation
 * file for.
 */
export enum TranslationLanguage {
  English = 'en',
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
