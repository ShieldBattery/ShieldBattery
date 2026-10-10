import i18n, { TFunction } from 'i18next'
import HttpBackend, { HttpBackendOptions } from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'
import createDeferred from '../../common/async/deferred'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  TranslationNamespace,
} from '../../common/i18n'
import { JsonLocalStorageValue } from '../local-storage'
import { makePublicAssetUrl, makeServerUrl } from '../network/server-url'
import { getBestLanguage } from './language-detector'

const isDev = import.meta.env.DEV
const CUR_VERSION = import.meta.env.SB_VERSION

/**
 * Type to use for interpolations in `Trans` components since React doesn't allow objects as
 * children.
 *
 * Taken as a best solution from this comment:
 * https://github.com/i18next/react-i18next/issues/1483#issuecomment-1268455602
 */
export type TransInterpolation = any

/**
 * The language this device last applied from an account's locale or the user's explicit choice.
 * Logged-out startups use it, since the browser's language list can rank a language the user never
 * picked above the one they did.
 */
const lastLanguage = new JsonLocalStorageValue<string>('lastLanguage')

export function rememberLanguage(language: string) {
  lastLanguage.setValue(language)
}

/**
 * The language to use before any account's locale is known: the remembered one if there is one,
 * otherwise the best match for the browser's languages. We send this to the server during
 * getCurrentSession, and an account without a locale adopts it.
 */
export function getStartupLanguage(): string {
  const remembered = lastLanguage.getValue()
  return remembered && (ALL_TRANSLATION_LANGUAGES as ReadonlyArray<string>).includes(remembered)
    ? remembered
    : getBestLanguage()
}

const i18nextDeferred = createDeferred<TFunction>()

export const i18nextPromise = i18nextDeferred.then(i18next => i18next)

/**
 * Initializes i18next. This should only be called after the ServerConfig is ready, as it uses
 * the CDN address to load translations.
 */
export function initI18next() {
  const i18next = i18n
    .use(HttpBackend)
    .use(initReactI18next)
    .init<HttpBackendOptions>({
      backend: {
        loadPath: makePublicAssetUrl(
          '/locales/{{lng}}/{{ns}}.json?' + encodeURIComponent(CUR_VERSION),
        ),
        addPath: makeServerUrl('/locales/add/{{lng}}/{{ns}}'),
      },

      saveMissing: isDev,
      saveMissingTo: 'all', // Save the missing keys to all languages

      lng: getStartupLanguage(),
      supportedLngs: ALL_TRANSLATION_LANGUAGES,
      fallbackLng: TranslationLanguage.English,

      // These are basically the defaults, but just defining them explicitly if we ever decide to
      // use namespaces.
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
  i18n.on('languageChanged', lang => {
    document.documentElement.lang = lang
    document.body.dataset.lang = lang
  })

  i18next.then(
    r => i18nextDeferred.resolve(r),
    e => i18nextDeferred.reject(e),
  )

  return i18nextPromise
}

export default i18n
