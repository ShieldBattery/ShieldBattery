import makeConfig from '../common.webpack.config.js'
import path from 'path'

const webpackOpts = {
  // Relative to the root directory
  entry: './client/index.jsx',
  output: {
    filename: 'client.js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: '/scripts/',
  },
  resolveLoader: {
    // Look for loaders in server's node_modules directory, instead of client's
    root: path.join(__dirname, 'node_modules'),
  },
}
const babelOpts = {
  cacheDirectory: true,
  // Note that these need to be installed in the root package.json, not the server one
  presets: ['react', 'es2015', 'es2016', 'es2017', 'stage-0'],
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
const cssNextOpts = { browsers: 'last 2 versions' }

export default makeConfig(webpackOpts, babelOpts, cssNextOpts, { SB_ENV: 'web' })
