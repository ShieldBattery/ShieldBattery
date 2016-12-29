// Can't use ES6 imports in this file because this won't be running through Babel
require('babel-register')
const makeConfig = require('./common.webpack.config.js').default
const path = require('path')

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

const webpackOpts = {
  target: 'electron',
  entry: './client/index.jsx',
  output: {
    path: path.join(__dirname, 'app', 'dist'),
    filename: 'bundle.js',
  },
  devtool: isProd ? 'hidden-source-map' : 'cheap-eval-source-map',
}
const babelOpts = {
  cacheDirectory: true,
  presets: ['react', 'node7', 'stage-0'],
  plugins: ['transform-decorators-legacy'],
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

module.exports = makeConfig(webpackOpts, babelOpts, cssNextOpts, { SB_ENV: 'electron' })
