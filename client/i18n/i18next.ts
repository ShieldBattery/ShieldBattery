import i18n from 'i18next'
import HttpBackend, { HttpBackendOptions } from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  TranslationNamespace,
} from '../../common/i18n'
import { makeServerUrl } from '../network/server-url'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

export const i18nextPromise = i18n
  .use(HttpBackend)
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
