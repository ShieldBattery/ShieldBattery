// Can't use ES6 imports in this file because this won't be running through Babel
require('dotenv').config({ path: '.env-build', quiet: true })
require('./babel-register')
const makeConfig = require('./common.webpack.config.js').default
const path = require('path')

// Configuration for the main process scripts of Electron (the app/ scripts)
const mainWebpackOpts = {
  target: 'electron-main',
  entry: {
    index: './app/startup.js',
    // The replay library's DB/watcher/parser run in a worker thread; this is its (self-contained)
    // bundle, loaded via `new Worker(...)` from the main bundle. prod.yml/staging.yml place the
    // output next to index.js so its native better-sqlite3 addon resolves.
    'db-worker': './app/replay-library/worker/db-worker.ts',
  },
  output: {
    filename: '[name].js',
    chunkFilename: '[name].appchunk.js',
    path: path.join(__dirname, 'app', 'dist'),
    libraryTarget: 'commonjs2',
  },
  plugins: [],
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
        targets: { electron: '43' },
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
    SB_SECURITY_IMPL: process.env.SB_BUILD_SECURITY_CLIENTS_IMPL
      ? JSON.stringify(path.resolve(__dirname, process.env.SB_BUILD_SECURITY_CLIENTS_IMPL))
      : undefined,
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
})

// The renderer is built by Vite (see vite.electron.config.ts); this only covers the Node-side
// bundles, which are only ever built for production.
module.exports = [electronMain, electronPreload]
