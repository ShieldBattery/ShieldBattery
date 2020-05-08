// Common webpack config settings, call with options specific to each environment to create a real
// config

import path from 'path'
import webpack from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import OptimizeCSSAssetsPlugin from 'optimize-css-assets-webpack-plugin'
import TerserJSPlugin from 'terser-webpack-plugin'
import packageJson from './package.json'

const VERSION = packageJson.version

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

export default function ({
  webpack: webpackOpts,
  babel: babelOpts,
  hotUrl,
  globalDefines = {},
  envDefines = {},
  extraRules = [],
}) {
  const postCssOpts = JSON.stringify({
    config: {
      path: path.join(__dirname, 'postcss.config.js'),
      ctx: {
        target: webpackOpts.target,
      },
    },
  })

  const styleRule = {
    test: /\.css$/,
    use: [
      isProd ? MiniCssExtractPlugin.loader : 'style-loader',
      {
        loader: 'css-loader',
        options: {
          modules: {
            localIdentName: !isProd ? '[name]__[local]__[hash:base64:5]' : '[hash:base64]',
          },
          importLoaders: 1,
        },
      },
      // NOTE(tec27): We have to use the string form here or css-loader screws up at importing
      // this loader because it's a massive pile of unupdated crap
      `postcss-loader?${postCssOpts}`,
    ],
  }

  const config = {
    ...webpackOpts,
    mode: isProd ? 'production' : 'development',
    context: __dirname,
    module: {
      rules: [
        {
          test: /\.jsx?$/,
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
        styleRule,
        {
          // Dumb workaround for `iconv-lite` not fixing their bugs. See this issue for more info:
          // https://github.com/ashtuchkin/iconv-lite/issues/204
          test: /node_modules[\/\\](iconv-lite)[\/\\].+/,
          resolve: {
            aliasFields: ['main'],
          },
        },
        ...extraRules,
      ],
    },
    optimization: {
      noEmitOnErrors: true,
      minimizer: isProd ? [new TerserJSPlugin({}), new OptimizeCSSAssetsPlugin({})] : [],
    },
    plugins: [
      ...webpackOpts.plugins,
      // get rid of errors caused by any-promise's crappy codebase, by replacing it with a module
      // that just exports whatever Promise babel is using
      new webpack.NormalModuleReplacementPlugin(
        /[\\/]any-promise[\\/]/,
        require.resolve('./app/common/promise.js'),
      ),
      new webpack.DefinePlugin({
        ...globalDefines,
        'process.webpackEnv': {
          NODE_ENV: JSON.stringify(nodeEnv),
          VERSION: `"${VERSION}"`,
          ...envDefines,
        },
      }),
    ],
  }

  if (!isProd) {
    // Allow __filename usage in our files in dev
    config.node = { __filename: true, __dirname: true }
    config.devtool = 'cheap-module-eval-source-map'

    if (hotUrl) {
      config.entry = [hotUrl, config.entry]
      config.plugins = config.plugins.concat([new webpack.HotModuleReplacementPlugin()])
      config.resolve = {
        ...(config.resolve || {}),
        alias: {
          'react-dom': '@hot-loader/react-dom',
        },
      }
    } else {
      // webpack-hot-client doesn't allow string entries for no fucking apparent reason at all.
      config.entry = [config.entry]
    }
  } else {
    if (config.target === 'electron-main') {
      // Disable webpack processing of these since electron-main scripts can actually make use of
      // the path (and does for loading things like icons/sounds out of the ASAR)
      config.node = { __filename: false, __dirname: false }
    }

    config.plugins = config.plugins.concat([
      new webpack.DefinePlugin({
        // We only define the exact field here to avoid overwriting all of process.env
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      new MiniCssExtractPlugin({
        filename: '../styles/site.css',
      }),
    ])

    config.devtool = 'hidden-source-map'
  }

  return config
}
