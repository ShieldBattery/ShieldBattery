// Can't use ES6 imports in this file because this won't be running through Babel
require('dotenv').config({ path: '.env-build', quiet: true })
require('./babel-register')
const makeConfig = require('./common.webpack.config.js').default
const path = require('path')
const webpack = require('webpack')

// Configuration for the web part of the electron process (the client/ scripts
// compiled for electron)
const webWebpackOpts = {
  // NOTE(tec27): Since we sandbox + context-isolate, this acts like a normal web browser
  target: 'web',
  entry: {
    bundle: './client/index.jsx',
  },
  output: {
    chunkFilename: '[name].chunk.js',
    filename: '[name].js',
    path: path.join(__dirname, 'app', 'dist'),
    publicPath: process.env.NODE_ENV !== 'production' ? 'http://localhost:5566/dist/' : '/dist/',
    crossOriginLoading: 'anonymous',
  },
  plugins: [
    // For whatever reason, `import type { ... } from 'electron'` isn't being removed by
    // babel/preset-typescript, so we just ignore them instead.
    new webpack.IgnorePlugin({ checkResource: resource => resource === 'electron' }),
  ],
}

const webBabelOpts = {
  babelrc: false,
  configFile: false,
  cacheDirectory: process.env.NODE_ENV !== 'production',
  presets: [
    ['@babel/preset-react', { runtime: 'automatic' }],
    [
      '@babel/preset-env',
      {
        targets: { electron: '35.0' },
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
    ['babel-plugin-const-enum'],
  ].concat(process.env.NODE_ENV !== 'production' ? [['react-refresh/babel']] : []),
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
    require('dotenv-expand')(require('dotenv').config({ path: './.env' }))
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
    SB_ANALYTICS_ID: process.env.SB_ANALYTICS_ID
      ? JSON.stringify(process.env.SB_ANALYTICS_ID)
      : undefined,
    SB_SERVER: SB_SERVER ? JSON.stringify(SB_SERVER) : undefined,
  },
})

const clientImpl = process.env.SB_BUILD_SECURITY_CLIENTS_IMPL

// Configuration for the main process scripts of Electron (the app/ scripts)
const mainWebpackOpts = {
  target: 'electron-main',
  entry: {
    index: './app/startup.js',
  },
  output: {
    filename: '[name].js',
    chunkFilename: '[name].appchunk.js',
    path: path.join(__dirname, 'app', 'dist'),
    libraryTarget: 'commonjs2',
  },
  plugins: !clientImpl
    ? []
    : [
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]app[\\/]security[\\/]client.ts/,
          path.resolve(__dirname, clientImpl),
        ),
      ],
}

// Configuration for the Electron preload script. Note that this uses the same
// babel config as the main process scripts
const preloadWebpackOpts = {
  target: 'electron-preload',
  entry: {
    preload: './app/preload.js',
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, 'app', 'dist'),
  },
  plugins: [],
}

const mainBabelOpts = {
  babelrc: false,
  configFile: false,
  cacheDirectory: process.env.NODE_ENV !== 'production',
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { electron: '35.0' },
        modules: false,
        useBuiltIns: 'usage',
        corejs: 3,
      },
    ],
    ['@babel/preset-typescript'],
  ],
  plugins: [
    'babel-plugin-transform-typescript-metadata',
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['babel-plugin-const-enum'],
  ],
}

const electronMain = makeConfig({
  webpack: mainWebpackOpts,
  babel: mainBabelOpts,
  mainEntry: 'index',
  globalDefines: {
    IS_ELECTRON: true,
  },
  envDefines: {
    SB_ANALYTICS_ID: process.env.SB_ANALYTICS_ID
      ? JSON.stringify(process.env.SB_ANALYTICS_ID)
      : undefined,
    SB_SERVER: SB_SERVER ? JSON.stringify(SB_SERVER) : undefined,
  },
  extraRules: [
    {
      test: /\.node$/,
      use: [
        {
          loader: 'native-addon-loader',
          options: {
            name: './native/[name]-[hash].[ext]',
          },
        },
      ],
    },
  ],
})

const electronPreload = makeConfig({
  webpack: preloadWebpackOpts,
  babel: mainBabelOpts,
  mainEntry: 'preload',
  globalDefines: {
    IS_ELECTRON: true,
  },
  envDefines: {
    SB_ANALYTICS_ID: process.env.SB_ANALYTICS_ID
      ? JSON.stringify(process.env.SB_ANALYTICS_ID)
      : undefined,
    SB_SERVER: SB_SERVER ? JSON.stringify(SB_SERVER) : undefined,
  },
})

module.exports =
  process.env.NODE_ENV === 'production' ? [electronWeb, electronMain, electronPreload] : electronWeb
