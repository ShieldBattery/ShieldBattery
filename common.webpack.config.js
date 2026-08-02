// Common webpack config settings, call with options specific to each environment to create a real
// config.
//
// Only the Electron main process, its preload and the replay DB worker are built here; the
// renderer moved to Vite (see vite.electron.config.ts), which took the loaders for browser assets,
// the chunk splitting and the hot-reload plumbing with it.

import TerserWebpackPlugin from 'terser-webpack-plugin'
import webpack from 'webpack'
import packageJson from './package.json'

const VERSION = packageJson.version

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

export default function ({
  webpack: webpackOpts,
  babel: babelOpts,
  mainEntry,
  globalDefines = {},
  envDefines = {},
  extraRules = [],
}) {
  if (!webpackOpts.entry[mainEntry]) {
    throw new Error(`Could not find entry called '${mainEntry}'`)
  }

  const config = {
    ...webpackOpts,
    mode: isProd ? 'production' : 'development',
    context: __dirname,
    externals: {
      ...webpackOpts.externals,
    },
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'babel-loader',
              options: babelOpts,
            },
          ],
        },
        ...extraRules,
      ],
    },
    optimization: {
      minimizer: isProd ? [new TerserWebpackPlugin()] : [],
    },
    plugins: [
      new webpack.DefinePlugin({
        ...globalDefines,

        __WEBPACK_ENV: {
          NODE_ENV: JSON.stringify(nodeEnv),
          VERSION: `"${VERSION}"`,
          ...envDefines,
        },
      }),
      ...webpackOpts.plugins,
    ],

    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      ...webpackOpts.resolve,
    },
  }

  if (!isProd) {
    // Allow __filename usage in our files in dev
    config.node = { __filename: true, __dirname: true }
    config.devtool = 'eval-cheap-module-source-map'
  } else {
    if (config.target === 'electron-main') {
      // Disable webpack processing of these since electron-main scripts can actually make use of
      // the path (and does for loading things like icons/sounds out of the ASAR)
      config.node = { __filename: false, __dirname: false }
    }

    config.plugins = [
      new webpack.DefinePlugin({
        // We only define the exact field here to avoid overwriting all of process.env
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      ...config.plugins,
    ]

    config.devtool = 'hidden-source-map'
  }

  return config
}
