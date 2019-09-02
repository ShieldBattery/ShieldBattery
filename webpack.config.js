// Can't use ES6 imports in this file because this won't be running through Babel
require('@babel/register')
const makeConfig = require('./common.webpack.config.js').default
const babelPlugins = require('./babel.config.js').plugins
const path = require('path')
const webpack = require('webpack')

const webpackOpts = {
  target: 'electron-renderer',
  entry: './client/index.jsx',
  output: {
    filename: 'bundle.js',
    path: path.join(__dirname, 'app', 'dist'),
    publicPath: 'http://localhost:5566/dist/',
    libraryTarget: 'commonjs2',
  },
  plugins: [new webpack.HotModuleReplacementPlugin()],
}

const babelOpts = {
  babelrc: false,
  cacheDirectory: true,
  presets: [
    '@babel/react',
    [
      '@babel/env',
      {
        targets: { electron: '1.7' },
        modules: false,
        useBuiltIns: 'entry',
        corejs: '3.0.0',
      },
    ],
  ],
  plugins: babelPlugins.concat(
    process.env.NODE_ENV !== 'production' ? ['react-hot-loader/babel'] : [],
  ),
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
    const serverConfig = require('./server/config.js').default
    if (serverConfig.canonicalHost) {
      return serverConfig.canonicalHost
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
