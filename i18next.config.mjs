// Translation extraction for the app's `global` namespace and the game DLL's `game` namespace
// (`pnpm gen-translations:app`). Only `en` is listed: it is the source language, grown from the
// default strings in code, while the other languages are managed by `pnpm run i18n`
// (tools/i18n-translate.ts) and must not be touched here.
import { rustTranslations } from './tools/i18next-rust-plugin.mjs'

export default {
  locales: ['en'],
  extract: {
    input: ['client/**/*.{js,jsx,ts,tsx}', 'common/**/*.{js,jsx,ts,tsx}'],
    output: 'server/public/locales/{{language}}/{{namespace}}.json',
    defaultNS: 'global',
    sort: true,
    removeUnusedKeys: true,
    // Keep `<Trans>` children as index tags (`<1>…</1>`) rather than literal `<strong>` etc., which
    // is the form react-i18next resolves at runtime and the form every translated catalog uses.
    transKeepBasicHtmlNodesFor: [],
  },
  // The in-game UI's strings live in Rust, which i18next-cli can't parse itself.
  plugins: [rustTranslations({ roots: ['game'] })],
}
