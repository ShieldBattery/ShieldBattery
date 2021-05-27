require('../babel-register')
const makeConfig = require('../common.webpack.config.js').default
const path = require('path')

const TARGET_BROWSERS = 'last 2 versions, not dead, not ie 11, not ie_mob 11, not op_mini all'

const webpackOpts = {
  // Relative to the root directory
  name: 'server',
  entry: {
    client: './client/index.jsx',
  },
  output: {
    chunkFilename: '[name].chunk.js',
    filename: '[name].js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: '/scripts/',
  },
  plugins: [],
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
    '@babel/preset-react',
    [
      '@babel/preset-env',
      {
        targets: { browsers: TARGET_BROWSERS },
        modules: false,
        useBuiltIns: 'usage',
        corejs: 3,
      },
    ],
    ['@babel/preset-typescript', { allExtensions: true, isTSX: true }],
  ],
  plugins: [
    ['babel-plugin-styled-components'],
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    ['@babel/plugin-proposal-private-methods', { loose: true }],
    ['@babel/plugin-proposal-nullish-coalescing-operator'],
    ['@babel/plugin-proposal-optional-chaining'],
    ['babel-plugin-const-enum'],
    ['react-hot-loader/babel'],
  ],
}

module.exports = makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  mainEntry: 'client',
  globalDefines: {
    IS_ELECTRON: false,
  },
})
