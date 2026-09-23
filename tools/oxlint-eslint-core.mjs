// ESLint core rules that oxlint has no native port of, run through oxlint's JS plugin support
// (`jsPlugins` in .oxlintrc.json). `eslint` stays a devDependency only to provide these.
//
// oxlint reserves the `eslint` plugin name for its own ports, so these are addressed as
// `eslint-core/<rule>`, in configs and in disable directives alike.
import { builtinRules } from 'eslint/use-at-your-own-risk'

export default {
  meta: { name: 'eslint-core' },
  rules: {
    camelcase: builtinRules.get('camelcase'),
    'no-undef-init': builtinRules.get('no-undef-init'),
  },
}
