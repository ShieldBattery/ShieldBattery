/**
 * A string representation of each of the languages that we support and expect to have a translation
 * file for.
 */
export enum TranslationLanguages {
  English = 'en',
}

export const ALL_TRANSLATION_LANGUAGES: ReadonlyArray<TranslationLanguages> =
  Object.values(TranslationLanguages)

/**
 * A string representation of all the namespaces we're using for our translation files. Currently
 * we're not using different namespaces and we're just defining the default one.
 */
export enum TranslationNamespaces {
  Translation = 'translation',
}

export const ALL_TRANSLATION_NAMESPACES: ReadonlyArray<TranslationNamespaces> =
  Object.values(TranslationNamespaces)
