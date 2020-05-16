require('@babel/register')({
  // This is necessary to make babel compile stuff outside the "working directory".
  // See this issue for more info: https://github.com/babel/babel/issues/8321
  ignore: [/node_modules/],
})
const makeConfig = require('../common.webpack.config.js').default
const path = require('path')

const TARGET_BROWSERS = 'last 2 versions, not dead, not ie 11, not ie_mob 11, not op_mini all'

const webpackOpts = {
  // Relative to the root directory
  name: 'server',
  entry: ['./client/index.jsx'],
  output: {
    filename: 'client.js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: '/scripts/',
  },
  plugins: [],
  resolve: {
    // Look for modules and loaders in server's node_modules directory, instead of client's
    modules: [path.join(__dirname, 'node_modules'), 'node_modules'],
  },
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
  ].concat(process.env.NODE_ENV !== 'production' ? ['react-hot-loader/babel'] : []),
}

module.exports = makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  globalDefines: {
    IS_ELECTRON: false,
  },
  hotInPlace: process.env.NODE_ENV !== 'production',
})
