require('../babel-register')
const makeConfig = require('../common.webpack.config.js').default
const path = require('path')
const { WebpackAssetsManifest } = require('webpack-assets-manifest')

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

const webpackOpts = {
  // Relative to the root directory
  name: 'server',
  entry: {
    client: './client/index.jsx',
  },
  output: {
    chunkFilename: isProd ? '[name].[contenthash:8].chunk.js' : '[name].chunk.js',
    filename: isProd ? '[name].[contenthash:8].js' : '[name].js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: 'auto',
    crossOriginLoading: 'anonymous',
  },
  plugins: [
    ...(isProd
      ? [
          new WebpackAssetsManifest({
            output: 'manifest.json',
            publicPath: '/scripts/',
            writeToDisk: true,
            entrypoints: true,
            entrypointsUseAssets: true,
          }),
        ]
      : []),
  ],
}

if (process.env.NODE_ENV !== 'production') {
  webpackOpts.entry.client = ['webpack-hot-middleware/client', webpackOpts.entry.client].flat()
}

const babelOpts = {
  babelrc: false,
  configFile: false,
  cacheDirectory: process.env.NODE_ENV !== 'production',
  // Note that these need to be installed in the root package.json, not the server one
  presets: [
    ['@babel/preset-react', { runtime: 'automatic' }],
    [
      '@babel/preset-env',
      {
        // Targets come from the `browserslist` key in the root package.json
        modules: false,
        useBuiltIns: 'usage',
        corejs: 3,
      },
    ],
    ['@babel/preset-typescript', { allExtensions: true, isTSX: true }],
  ].concat(process.env.NODE_ENV !== 'production' ? [['jotai/babel/preset']] : []),
  plugins: [
    ['babel-plugin-react-compiler'],
    [
      require('@graphql-codegen/client-preset').babelOptimizerPlugin,
      { artifactDirectory: './client/gql/', gqlTagName: 'graphql' },
    ],
    ['babel-plugin-styled-components'],
    ['@babel/plugin-proposal-decorators', { legacy: true }],
  ].concat(isProd ? [] : [['react-refresh/babel', { skipEnvCheck: true }]]),
}

module.exports = makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  mainEntry: 'client',
  globalDefines: {
    IS_ELECTRON: false,
  },
})
