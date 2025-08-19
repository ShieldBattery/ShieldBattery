// Common webpack config settings, call with options specific to each environment to create a real
// config

import ReactRefreshWebpackPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import TerserWebpackPlugin from 'terser-webpack-plugin'
import webpack from 'webpack'
import packageJson from './package.json'

const VERSION = packageJson.version

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

export default function ({
  webpack: webpackOpts,
  babel: babelOpts,
  splitChunks = true,
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
      // Don't include jotai-devtools in prod
      ...(isProd
        ? {
            'jotai-devtools': 'window',
          }
        : {}),
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
        {
          test: /\.svg$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'babel-loader',
              options: babelOpts,
            },
            {
              loader: 'react-svg-loader',
              options: {
                jsx: true,
                svgo: {
                  plugins: [
                    {
                      removeViewBox: false,
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          test: /\.md$/,
          exclude: /README.md$/,
          use: [{ loader: 'html-loader' }, { loader: 'markdown-loader' }],
        },
        {
          test: /\.html?$/,
          use: [{ loader: 'html-loader' }],
        },
        // We only need CSS for jotai-devtools, which is dev-only
        ...(isProd
          ? []
          : [
              {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
              },
            ]),
        ...extraRules,
      ],
    },
    optimization: {
      minimizer: isProd ? [new TerserWebpackPlugin()] : [],
      splitChunks:
        isProd && splitChunks
          ? {
              chunks: 'all',
              cacheGroups: {
                vendor: {
                  test: /[\\/]node_modules[\\/]/,
                  name: 'vendor',
                  chunks: 'initial',
                  priority: -10,
                },
                react: {
                  test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
                  name: 'react',
                  chunks: 'all',
                  priority: 30,
                },
                state: {
                  test: /[\\/]node_modules[\\/](immer|immutable|jotai|redux|react-redux|@reduxjs)[\\/]/,
                  name: 'state',
                  chunks: 'all',
                  priority: 25,
                },
              },
            }
          : undefined,
    },
    plugins: [
      new webpack.DefinePlugin({
        ...globalDefines,

        // This value will be set by Electron/our server in an inline script with a nonce value
        // matching the CSP headers for the request. Having this define makes things work while
        // hot reloading as well.
        // eslint-disable-next-line camelcase
        __webpack_nonce__: 'window.SB_CSP_NONCE',

        __WEBPACK_ENV: {
          NODE_ENV: JSON.stringify(nodeEnv),
          VERSION: `"${VERSION}"`,
          ...envDefines,
        },
      }),
      ...webpackOpts.plugins,
    ].concat(
      isProd ? [] : [new ReactRefreshWebpackPlugin({ overlay: { sockIntegration: 'whm' } })],
    ),

    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      ...webpackOpts.resolve,
    },
  }

  if (!isProd) {
    // Allow __filename usage in our files in dev
    config.node = { __filename: true, __dirname: true }
    config.devtool = 'eval-cheap-module-source-map'
    config.plugins = config.plugins.concat([new webpack.HotModuleReplacementPlugin()])
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
