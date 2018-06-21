// Common webpack config settings, call with options specific to each environment to create a real
// config

import path from 'path'
import webpack from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import packageJson from './package.json'

const VERSION = packageJson.version

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

export default function({
  webpack: webpackOpts,
  babel: babelOpts,
  globalDefines = {},
  envDefines = {},
  minify,
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
    use: !isProd
      ? [
          { loader: 'style-loader' },
          {
            loader: 'css-loader',
            options: {
              modules: true,
              importLoaders: 1,
              localIdentName: '[name]__[local]__[hash:base64:5]',
            },
          },
          // NOTE(tec27): We have to use the string form here or css-loader screws up at importing
          // this loader because it's a massive pile of unupdated crap
          `postcss-loader?${postCssOpts}`,
        ]
      : [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: true,
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
              },
            },
          ],
        },
        {
          test: /\.md$/,
          exclude: /README.md$/,
          use: [{ loader: 'html-loader' }, { loader: 'markdown-loader' }],
        },
        /* {
          test: /\.css$/,
          use: [
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            'postcss-loader',
          ],
        },*/
        styleRule,
      ],
    },
    optimization: {
      noEmitOnErrors: true,
      splitChunks: isProd
        ? {
            cacheGroups: {
              styles: {
                name: 'styles',
                test: /\.css$/,
                chunks: 'all',
                enforce: true,
              },
            },
          }
        : undefined,
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
  } else {
    config.plugins = config.plugins.concat([
      new webpack.DefinePlugin({
        // We only define the exact field here to avoid overwriting all of process.env
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      /* new ExtractTextPlugin({
        // This path is relative to the publicPath, not this file's directory
        filename: '../styles/site.css',
        allChunks: true,
      }),*/
      new MiniCssExtractPlugin({
        filename: '../styles/site.css',
      }),
    ])
    if (minify) {
      config.plugins.push(
        new webpack.optimize.UglifyJsPlugin({
          compress: { warnings: false },
          output: { comments: false },
          sourceMap: true,
        }),
      )
    }
    config.devtool = 'hidden-source-map'
  }

  return config
}
