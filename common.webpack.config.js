// Common webpack config settings, call with options specific to each environment to create a real
// config

import path from 'path'
import webpack from 'webpack'
import ExtractTextPlugin from 'extract-text-webpack-plugin'
import packageJson from './package.json'

const VERSION = packageJson.version

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

export default function({
  webpack: webpackOpts,
  babel: babelOpts,
  hotUrl,
  envDefines = {},
  minify,
}) {
  const postCssOpts = JSON.stringify({
    config: {
      path: path.join(__dirname, 'postcss.config.js'),
      ctx: {
        target: webpackOpts.target
      },
    },
  })

  const styleRule = {
    test: /\.css$/,
    use: !isProd ? [
      { loader: 'style-loader' },
      {
        loader: 'css-loader',
        options: {
          modules: true,
          importLoaders: 1,
          localIdentName: '[name]__[local]__[hash:base64:5]',
        }
      },
      // NOTE(tec27): We have to use the string form here or css-loader screws up at importing this
      // loader because it's a massive pile of unupdated crap
      `postcss-loader?${postCssOpts}`,
    ] : ExtractTextPlugin.extract({
      fallback: 'style-loader',
      use: [
        {
          loader: 'css-loader',
          options: {
            modules: true,
            importLoaders: 1,
          }
        },
        // NOTE(tec27): We have to use the string form here or css-loader screws up at importing
        // this loader because it's a massive pile of unupdated crap
        `postcss-loader?${postCssOpts}`,
      ]
    })
  }

  const config = {
    ...webpackOpts,
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
            }
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
              }
            },
          ]
        },
        {
          test: /\.md$/,
          exclude: /README.md$/,
          use: [
            { loader: 'html-loader' },
            { loader: 'markdown-loader' },
          ],
        },
        styleRule
      ],
    },
    plugins: [
      // get rid of errors caused by any-promise's crappy codebase, by replacing it with a module
      // that just exports whatever Promise babel is using
      new webpack.NormalModuleReplacementPlugin(
        /[\\/]any-promise[\\/]/, require.resolve('./app/common/promise.js')),
      new webpack.DefinePlugin({
        'process.webpackEnv': {
          NODE_ENV: JSON.stringify(nodeEnv),
          VERSION: `"${VERSION}"`,
          ...envDefines
        },
      }),
    ],
  }

  if (!isProd) {
    // Allow __filename usage in our files in dev
    config.node = { __filename: true, __dirname: true }

    config.plugins.push(new webpack.HotModuleReplacementPlugin())
    // TODO(tec27): can we just remove this? Are any of our loaders actually using this?
    config.plugins.push(new webpack.LoaderOptionsPlugin({ debug: true }))
    config.devtool = 'cheap-module-eval-source-map'
    config.entry = [
      hotUrl,
      config.entry,
    ]
  } else {
    config.plugins = config.plugins.concat([
      new webpack.optimize.ModuleConcatenationPlugin(),
      new webpack.DefinePlugin({
        // We only define the exact field here to avoid overwriting all of process.env
        'process.env.NODE_ENV': JSON.stringify('production')
      }),
      new ExtractTextPlugin({
        // This path is relative to the publicPath, not this file's directory
        filename: '../styles/site.css',
        allChunks: true,
      }),
    ])
    if (minify) {
      config.plugins.push(new webpack.optimize.UglifyJsPlugin({
        compress: { warnings: false },
        output: { comments: false },
        sourceMap: true,
      }))
    }
    config.devtool = 'hidden-source-map'
  }
  config.plugins.push(new webpack.NoEmitOnErrorsPlugin())

  return config
}
