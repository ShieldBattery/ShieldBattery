import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpBackend, { HttpBackendOptions } from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'
import { LANGUAGE_SUPPORT } from '../../common/flags'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  TranslationNamespace,
} from '../../common/i18n'
import { makeServerUrl } from '../network/server-url'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

/**
 * Type to use for interpolations in `Trans` components since React doesn't allow objects as
 * children.
 *
 * Taken as a best solution from this comment:
 * https://github.com/i18next/react-i18next/issues/1483#issuecomment-1268455602
 */
export type TransInterpolation = any

export const i18nextPromise = i18n.use(HttpBackend).use(initReactI18next)

if (LANGUAGE_SUPPORT) {
  const languageDetector = new LanguageDetector(null, {
    order: ['navigator'],
    caches: [],
  })

  i18n.use(languageDetector)
}

i18n.init<HttpBackendOptions>({
  backend: {
    loadPath: makeServerUrl('/locales/{{lng}}/{{ns}}.json'),
    addPath: makeServerUrl('/locales/add/{{lng}}/{{ns}}'),
  },

  saveMissing: isDev,
  saveMissingTo: 'all', // Save the missing keys to all languages

  supportedLngs: ALL_TRANSLATION_LANGUAGES,
  fallbackLng: TranslationLanguage.English,

  // These are basically the defaults, but just defining them explicitly if we ever decide to use
  // namespaces.
  ns: TranslationNamespace.Global,
  defaultNS: TranslationNamespace.Global,
  fallbackNS: false,

  interpolation: {
    escapeValue: false, // Not needed for react as it escapes by default
  },

  // Some HTML attributes (e.g. `title`, `label`) only accept `string | undefined` as valid
  // values, so we configure our `t` function to not be able to return `null` values.
  returnNull: false,
})

export default i18n
