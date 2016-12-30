// Can't use ES6 imports in this file because this won't be running through Babel
require('babel-register')
const makeConfig = require('./common.webpack.config.js').default
const path = require('path')

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

const webpackOpts = {
  target: 'electron-renderer',
  entry: './client/index.jsx',
  output: {
    filename: 'bundle.js',
    path: path.join(__dirname, 'app', 'dist'),
    publicPath: 'http://localhost:5566/dist/',
    libraryTarget: 'commonjs2',
  },
  devtool: isProd ? 'hidden-source-map' : 'cheap-eval-source-map',
}
const babelOpts = {
  cacheDirectory: true,
  presets: ['react', 'node7', 'stage-0'],
  plugins: [
    'transform-decorators-legacy',
    // Need these to work around an issue in react-transform/react-hot-loader:
    // https://github.com/gaearon/react-hot-loader/issues/313
    'transform-class-properties',
    'transform-es2015-classes',
  ],
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

// This option is probably *too* safe given that we're deploying this on Electron, but I don't think
// it changes much, so whatever
const cssNextOpts = { browsers: 'last 2 Chrome versions' }
const hotUrl = 'webpack-hot-middleware/client?path=http://localhost:5566/__webpack_hmr'

module.exports = makeConfig(
    webpackOpts,
    babelOpts,
    cssNextOpts,
    hotUrl,
    { SB_ENV: JSON.stringify('electron') })
