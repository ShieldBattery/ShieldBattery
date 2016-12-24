import webpack from 'webpack'
import path from 'path'
import ExtractTextPlugin from 'extract-text-webpack-plugin'
import cssNext from 'postcss-cssnext'
import cssFor from 'postcss-for'
import cssMixins from 'postcss-mixins'
import packageJson from './package.json'

const VERSION = packageJson.version

const isDev = 'production' !== process.env.NODE_ENV

const cssLoader = 'css-loader?modules&importLoaders=1'
const styleLoader = {
  test: /\.css$/,
  loader:
      `style-loader!${cssLoader}&localIdentName=[name]__[local]___[hash:base64:5]!postcss-loader`,
}
if (!isDev) {
  styleLoader.loader = ExtractTextPlugin.extract('style-loader', `${cssLoader}!postcss-loader`)
}

const babelQuery = {
  cacheDirectory: true,
  presets: ['react', 'es2015', 'stage-0'],
  plugins: ['transform-runtime', 'transform-decorators-legacy'],
  env: {
    development: {
      plugins: [
        ['react-transform', {
          transforms: [{
            transform: 'react-transform-hmr',
            imports: ['react'],
            locals: ['module']
          }, {
            transform: 'react-transform-catch-errors',
            imports: ['react', 'redbox-react']
          }]
        }],
      ]
    }
  }
}

const webpackOptions = {
  entry: './client/index.jsx',
  output: {
    filename: 'client.js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: '/scripts/',
  },
  module: {
    loaders: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: 'babel',
        query: babelQuery,
      },
      {
        test: /\.svg$/,
        exclude: /node_modules/,
        loader: `babel?${JSON.stringify(babelQuery)}!svg-react`,
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
    new webpack.PrefetchPlugin('react'),
    new webpack.PrefetchPlugin('react-dom/lib/ReactComponentBrowserEnvironment'),
    new webpack.optimize.OccurenceOrderPlugin(),
    new webpack.DefinePlugin({
      'process.env': {
        VERSION: `"${VERSION}"`
      },
    }),
  ],
  postcss: [
    cssMixins,
    cssFor,
    cssNext({ browsers: 'last 2 versions' }),
  ],
}

if (isDev) {
  // Allow __filename usage in our files in dev
  webpackOptions.context = __dirname
  webpackOptions.node = { __filename: true }

  webpackOptions.plugins.push(new webpack.HotModuleReplacementPlugin())
  webpackOptions.debug = true
  webpackOptions.devtool = 'inline-source-map'
  webpackOptions.entry = [
    'webpack-hot-middleware/client',
    webpackOptions.entry,
  ]
} else {
  webpackOptions.plugins = webpackOptions.plugins.concat([
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: '"production"'
      }
    }),
    // This path is relative to the publicPath, not this file's directory
    new ExtractTextPlugin('../styles/site.css', { allChunks: true }),
    new webpack.optimize.UglifyJsPlugin({
      compress: { warnings: false },
      output: { comments: false },
    }),
    new webpack.optimize.DedupePlugin(),
  ])
  webpackOptions.devtool = 'source-map'
}
webpackOptions.plugins.push(new webpack.NoErrorsPlugin())

export default webpackOptions
