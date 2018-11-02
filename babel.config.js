// There is no more stage-0 preset so we have to list all of the plugins individually
const plugins = [
  '@babel/plugin-syntax-dynamic-import',
  '@babel/plugin-syntax-import-meta',
  // This has to be placed before class properties plugin for some reason.
  [
    '@babel/plugin-proposal-decorators',
    {
      legacy: true,
    },
  ],
  [
    '@babel/plugin-proposal-class-properties',
    {
      loose: true,
    },
  ],
  '@babel/plugin-proposal-json-strings',
  '@babel/plugin-proposal-function-sent',
  '@babel/plugin-proposal-export-namespace-from',
  '@babel/plugin-proposal-numeric-separator',
  '@babel/plugin-proposal-throw-expressions',
  '@babel/plugin-proposal-export-default-from',
  '@babel/plugin-proposal-logical-assignment-operators',
  '@babel/plugin-proposal-optional-chaining',
  [
    '@babel/plugin-proposal-pipeline-operator',
    {
      proposal: 'minimal',
    },
  ],
  '@babel/plugin-proposal-nullish-coalescing-operator',
  '@babel/plugin-proposal-do-expressions',
  '@babel/plugin-proposal-function-bind',
]

module.exports = function(api) {
  const env = api.env() // This also sets up caching of this file internally
  const envOpts = {}

  switch (env) {
    case 'app':
      envOpts.targets = { electron: '1.7' }
      break
    case 'node':
      envOpts.targets = { node: 'current' }
      break
  }

  const presets = [['@babel/preset-env', envOpts]]

  return {
    presets,
    plugins,
  }
}
module.exports.plugins = plugins
