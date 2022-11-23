import i18n from 'i18next'
import Backend from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguages,
  TranslationNamespaces,
} from '../../common/i18n'
import { makeServerUrl } from '../network/server-url'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: makeServerUrl('/locales/{{lng}}/{{ns}}.json'),
      addPath: makeServerUrl('/locales/add/{{lng}}/{{ns}}'),
    },

    saveMissing: isDev,
    saveMissingTo: 'all', // Save the missing keys to all languages

    supportedLngs: ALL_TRANSLATION_LANGUAGES,
    fallbackLng: TranslationLanguages.English,

    // These are basically the defaults, but just defining them explicitly if we ever decide to use
    // namespaces.
    ns: TranslationNamespaces.Translation,
    defaultNS: TranslationNamespaces.Translation,
    fallbackNS: false,

    interpolation: {
      escapeValue: false, // Not needed for react as it escapes by default
    },
  })
