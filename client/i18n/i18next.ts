import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpBackend, { HttpBackendOptions } from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  TranslationNamespace,
} from '../../common/i18n'
import { makeServerUrl } from '../network/server-url'
import { JsonSessionStorageValue } from '../session-storage'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

/**
 * Type to use for interpolations in `Trans` components since React doesn't allow objects as
 * children.
 *
 * Taken as a best solution from this comment:
 * https://github.com/i18next/react-i18next/issues/1483#issuecomment-1268455602
 */
export type TransInterpolation = any

/**
 * The locale that was reported to us by the user's browser. This locale can be overwritten by
 * user's explicit choice in the top-links dropdown. We send this locale to the server during
 * login/signup/getCurrentSession actions.
 *
 * NOTE(2Pac): Session storage gets cleared after logging in, so be careful about using this only in
 * the logged-out pages.
 */
export const detectedLocale = new JsonSessionStorageValue<string | undefined>('detectedLocale')

export const languageDetector = new LanguageDetector(null, {
  order: ['navigator'],
  caches: [],
})

export const i18nextPromise = i18n
  .use(HttpBackend)
  .use(languageDetector)
  .use(initReactI18next)
  .init<HttpBackendOptions>({
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
