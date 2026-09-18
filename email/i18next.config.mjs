// Translation extraction for the email templates' `email` namespace (`pnpm gen-translations:email`,
// run from the repository root). See the root i18next.config.mjs for why only `en` is listed.
export default {
  locales: ['en'],
  extract: {
    input: ['email/**/*.{js,jsx,ts,tsx}'],
    output: 'email/locales/{{language}}/{{namespace}}.json',
    defaultNS: 'email',
    sort: true,
    removeUnusedKeys: true,
    transKeepBasicHtmlNodesFor: [],
  },
}
