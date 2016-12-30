// Common webpack config settings, call with options specific to each environment to create a real
// config

import webpack from 'webpack'
import ExtractTextPlugin from 'extract-text-webpack-plugin'
import cssNext from 'postcss-cssnext'
import cssFor from 'postcss-for'
import cssMixins from 'postcss-mixins'
import packageJson from './package.json'

const VERSION = packageJson.version

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

const cssLoader = 'css-loader?modules&importLoaders=1'
const styleLoader = {
  test: /\.css$/,
  loader:
      `style-loader!${cssLoader}&localIdentName=[name]__[local]___[hash:base64:5]!postcss-loader`,
}
if (isProd) {
  styleLoader.loader = ExtractTextPlugin.extract('style-loader', `${cssLoader}!postcss-loader`)
}

export default function(webpackOpts, babelOpts, cssNextOpts, hotUrl, envDefines = {}) {
  const config = {
    ...webpackOpts,
    module: {
      loaders: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          loader: 'babel',
          query: babelOpts,
        },
        {
          test: /\.svg$/,
          exclude: /node_modules/,
          loader: `babel?${JSON.stringify(babelOpts)}!svg-react`,
        },
        {
          test: /\.md$/,
          exclude: /README.md$/,
          loader: 'html!markdown'
        },
        styleLoader
      ],
    },
    resolve: {
      extensions: ['', '.js']
    },
    plugins: [
      new webpack.optimize.OccurenceOrderPlugin(),
      // get rid of warnings from ws about native requires that its okay with failing
      new webpack.NormalModuleReplacementPlugin(
          /^bufferutil$/, require.resolve('ws/lib/BufferUtil.fallback.js')),
      new webpack.NormalModuleReplacementPlugin(
          /^utf-8-validate$/, require.resolve('ws/lib/Validation.fallback.js')),
      new webpack.DefinePlugin({
        'process.env': {
          NODE_ENV: JSON.stringify(nodeEnv),
          VERSION: `"${VERSION}"`,
          ...envDefines
        },
      }),
    ],
    postcss: [
      cssMixins,
      cssFor,
      cssNext(cssNextOpts),
    ],
  }

  if (!isProd) {
    // Allow __filename usage in our files in dev
    config.context = __dirname
    config.node = { __filename: true }

    config.plugins.push(new webpack.HotModuleReplacementPlugin())
    config.debug = true
    config.devtool = 'cheap-module-eval-source-map'
    config.entry = [
      hotUrl,
      config.entry,
    ]
  } else {
    config.plugins = config.plugins.concat([
      // This path is relative to the publicPath, not this file's directory
      new ExtractTextPlugin('../styles/site.css', { allChunks: true }),
      new webpack.optimize.UglifyJsPlugin({
        compress: { warnings: false },
        output: { comments: false },
      }),
      new webpack.optimize.DedupePlugin(),
    ])
    config.devtool = 'hidden-source-map'
  }
  config.plugins.push(new webpack.NoErrorsPlugin())

  return config
}
