// Can't use ES6 imports in this file because this won't be running through Babel
require('@babel/register')
const makeConfig = require('./common.webpack.config.js').default
const path = require('path')

// Configuration for the web part of the electron process (the client/ scripts
// compiled for electron)
const webWebpackOpts = {
  target: 'electron-renderer',
  entry: {
    bundle: './client/index.jsx',
  },
  output: {
    chunkFilename: '[name].chunk.js',
    filename: '[name].js',
    path: path.join(__dirname, 'app', 'dist'),
    publicPath: process.env.NODE_ENV !== 'production' ? 'http://localhost:5566/dist/' : '/dist/',
    libraryTarget: 'commonjs2',
  },
  plugins: [],
}

const webBabelOpts = {
  babelrc: false,
  // This makes babel-loader cache-bust if the NODE_ENV changes, which is what we want here, since
  // the BABEL_ENV has been set specifically for our builder's babel-register usage.
  envName: process.env.NODE_ENV,
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
    ['@babel/preset-typescript'],
  ],
  plugins: [
    ['babel-plugin-styled-components'],
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    ['react-hot-loader/babel'],
  ],
}

if (process.env.NODE_ENV !== 'production') {
  webWebpackOpts.entry.bundle = [
    'webpack-hot-middleware/client?path=http://localhost:5566/__webpack_hmr',
    webWebpackOpts.entry.bundle,
  ].flat()
}

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

console.error('Using a server of ' + SB_SERVER + ' by default')

const electronWeb = makeConfig({
  webpack: webWebpackOpts,
  babel: webBabelOpts,
  mainEntry: 'bundle',
  globalDefines: {
    IS_ELECTRON: true,
  },
  envDefines: {
    SB_SERVER: SB_SERVER ? JSON.stringify(SB_SERVER) : undefined,
  },
})

// Configuration for the main process scripts of Electron (the app/ scripts)
const mainWebpackOpts = {
  target: 'electron-main',
  entry: {
    index: './app/startup.js',
    // Since this is required via Electron's remote stuff, the module needs to exist somewhere. And
    // this also forces Webpack to process the file and copy the .node file over to outputs
    process: './app/native/process/index.js',
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, 'app', 'dist'),
    libraryTarget: 'commonjs2',
  },
  plugins: [],
}

const mainBabelOpts = {
  babelrc: false,
  // This makes babel-loader cache-bust if the NODE_ENV changes, which is what we want here, since
  // the BABEL_ENV has been set specifically for our builder's babel-register usage.
  envName: process.env.NODE_ENV,
  cacheDirectory: true,
  presets: [
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
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    ['@babel/plugin-proposal-function-bind'],
  ],
}

const electronMain = makeConfig({
  webpack: mainWebpackOpts,
  babel: mainBabelOpts,
  mainEntry: 'index',
  extraRules: [
    {
      test: /\.node$/,
      use: [
        {
          loader: 'native-addon-loader',
          options: {
            name: './[name]-[hash].[ext]',
          },
        },
      ],
    },
  ],
})

module.exports = process.env.NODE_ENV === 'production' ? [electronWeb, electronMain] : electronWeb
