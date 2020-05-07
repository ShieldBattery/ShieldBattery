// Can't use ES6 imports in this file because this won't be running through Babel
require('@babel/register')
const makeConfig = require('./common.webpack.config.js').default
const path = require('path')

const webpackOpts = {
  target: 'electron-renderer',
  entry: './client/index.jsx',
  output: {
    filename: 'bundle.js',
    path: path.join(__dirname, 'app', 'dist'),
    publicPath: 'http://localhost:5566/dist/',
    libraryTarget: 'commonjs2',
  },
  plugins: [],
}

const babelOpts = {
  babelrc: false,
  cacheDirectory: true,
  presets: [
    '@babel/preset-react',
    [
      '@babel/preset-env',
      {
        targets: { electron: '7.1' },
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

const hotUrl = 'webpack-hot-middleware/client?path=http://localhost:5566/__webpack_hmr'

const SB_SERVER = (() => {
  if (process.env.SB_SERVER) {
    return process.env.SB_SERVER
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://shieldbattery.net'
  }
  try {
    require('dotenv').config({ path: './server/.env' })
    if (process.env.SB_CANONICAL_HOST) {
      return process.env.SB_CANONICAL_HOST
    }
  } catch (err) {
    // Intentionally empty, just means the server config isn't there/is broken for some reason
  }
  // Just use a "default" server address
  return 'http://localhost:5555'
})()

console.log('Using a server of ' + SB_SERVER + ' by default')

module.exports = makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  hotUrl,
  globalDefines: {
    IS_ELECTRON: true,
  },
  envDefines: {
    SB_SERVER: SB_SERVER ? JSON.stringify(SB_SERVER) : undefined,
  },
})
