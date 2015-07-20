import webpack from 'webpack'
import autoprefixer from 'autoprefixer-stylus'
import path from 'path'
import ExtractTextPlugin from 'extract-text-webpack-plugin'

const isDev = 'production' !== process.env.NODE_ENV

const babelOptions = '?optional[]=runtime&stage=0&loose=all&cacheDirectory'
const jsLoader = isDev ? 'react-hot-loader!babel-loader' : 'babel-loader'
const autoprefix = autoprefixer({ browsers: ['last 2 version'] })

const stylusLoader = {
  test: /\.styl$/,
  loader: 'style-loader!css-loader!stylus-loader',
}
if (!isDev) {
  stylusLoader.loader = ExtractTextPlugin.extract('style-loader', 'css-loader!stylus-loader')
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
        loader: `${jsLoader}${babelOptions}`,
        exclude: /node_modules/,
      },
      stylusLoader
    ],
  },
  resolve: {
    extensions: ['', '.js']
  },
  plugins: [
    new webpack.PrefetchPlugin('react'),
    new webpack.PrefetchPlugin('react/lib/ReactComponentBrowserEnvironment'),
  ],
  stylus: [ autoprefix ],
}

if (isDev) {
  webpackOptions.plugins.push(new webpack.HotModuleReplacementPlugin())
  webpackOptions.debug = true
  webpackOptions.devtool = 'inline-source-map'
  webpackOptions.entry = [
    'webpack-dev-server/client?http://localhost:61337',
    'webpack/hot/dev-server',
    webpackOptions.entry,
  ]
  webpackOptions.output.publicPath = 'http://localhost:61337/scripts/'
} else {
  webpackOptions.plugins = webpackOptions.plugins.concat([
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: '"production"'
      }
    }),
    new ExtractTextPlugin('../styles/site.css'),
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
