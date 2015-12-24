import webpack from 'webpack'
import autoprefixer from 'autoprefixer-stylus'
import path from 'path'
import ExtractTextPlugin from 'extract-text-webpack-plugin'

const isDev = 'production' !== process.env.NODE_ENV
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
        exclude: /node_modules/,
        loader: 'babel',
        query: {
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
    new webpack.optimize.OccurenceOrderPlugin(),
  ],
  stylus: {
    use: [ autoprefix ],
  },
}

if (isDev) {
  webpackOptions.plugins.push(new webpack.HotModuleReplacementPlugin())
  webpackOptions.debug = true
  webpackOptions.devtool = 'inline-source-map'
  webpackOptions.entry = [
    'webpack-hot-middleware/client?overlay=false',
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
