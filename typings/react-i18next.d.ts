import 'react-i18next'

declare module 'react-i18next' {
  // The types for react-i18next aren't completely accurate to their actual exports, as they say
  // that the `Trans` export is `TransWithoutContext` but don't also export `TransWithoutContext`.
  // We need `TransWithoutContext` to use `Trans` in emails, so we have to add it here.
  export { Trans as TransWithoutContext } from 'react-i18next'
}
