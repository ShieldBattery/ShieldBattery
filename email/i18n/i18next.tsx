import i18n from 'i18next'
import FsBackend, { FsBackendOptions } from 'i18next-fs-backend'
import path from 'path'
import React from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { ALL_TRANSLATION_LANGUAGES } from '../../common/i18n'

export { t } from 'i18next'

/**
 * Type to use for interpolations in `Trans` components since React doesn't allow objects as
 * children.
 *
 * Taken as a best solution from this comment:
 * https://github.com/i18next/react-i18next/issues/1483#issuecomment-1268455602
 */
export type TransInterpolation = any

export const i18nextPromise = i18n
  .use(FsBackend)
  .use(initReactI18next)
  .init<FsBackendOptions>({
    backend: {
      loadPath: path.resolve(__dirname, '..', '/locales/{{lng}}/{{ns}}.json'),
    },

    // Load the files synchronously
    initImmediate: false,

    // TODO(tec27): maybe we can use this? I don't think it sorts though
    saveMissing: false,

    supportedLngs: ALL_TRANSLATION_LANGUAGES,
    fallbackLng: 'en',

    ns: 'email',
    defaultNS: 'email',
    fallbackNS: false,

    interpolation: {
      escapeValue: false, // Not needed for react as it escapes by default
    },

    // Some HTML attributes (e.g. `title`, `label`) only accept `string | undefined` as valid
    // values, so we configure our `t` function to not be able to return `null` values.
    returnNull: false,
  })

export default i18n

export function translatedEmail(Component: () => React.ReactNode) {
  return () => (
    <I18nextProvider i18n={i18n} defaultNS={'email'}>
      <Component />
    </I18nextProvider>
  )
}
