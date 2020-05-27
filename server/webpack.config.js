require('@babel/register')
const makeConfig = require('../common.webpack.config.js').default
const path = require('path')

const TARGET_BROWSERS = 'last 2 versions, not dead, not ie 11, not ie_mob 11, not op_mini all'

const webpackOpts = {
  // Relative to the root directory
  name: 'server',
  entry: ['./client/index.jsx'],
  output: {
    chunkFilename: '[name].chunk.js',
    filename: 'client.js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: '/scripts/',
  },
  plugins: [],
}

if (process.env.NODE_ENV !== 'production') {
  webpackOpts.entry.unshift('webpack-hot-middleware/client')
}

const babelOpts = {
  babelrc: false,
  cacheDirectory: true,
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
  ],
  plugins: [
    ['babel-plugin-styled-components'],
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    ['@babel/plugin-proposal-function-bind'],
    ['react-hot-loader/babel'],
  ],
}

module.exports = makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  globalDefines: {
    IS_ELECTRON: false,
  },
})
