import path from 'path'
import webpack from 'webpack'
import StringReplacePlugin from 'string-replace-webpack-plugin'

const bundleDir = path.join(__dirname, 'bundle')
const bundleJsDir = path.join(bundleDir, 'js')
const entry = path.resolve(__dirname, '../js/index.js')

const options = {
  entry,
  target: 'node',
  output: {
    path: bundleJsDir,
    filename: 'index.js'
  },
  module: {
    loaders: [
      // Work around an issue with json-schema doing a weird AMD check and being broken in webpack
      {
        test: /validate.js$/,
        include: /node_modules(\\|\/)json-schema/,
        loader: StringReplacePlugin.replace({
          replacements: [{
            pattern: /\(\{define:typeof define!="undefined"\?define:function\(deps, factory\)\{module\.exports = factory\(\);\}\}\)\./ig, // eslint-disable-line max-len
            replacement(match, p1, offset, string) {
              return ''
            },
          }]
        })
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel',
      },
      {
        test: /shaders.+\..+sl$/,
        exclude: /node_modules/,
        loader: 'raw',
      },
      {
        test: /\.json$/,
        loader: 'json',
      }
    ]
  },
  resolve: {
    extensions: ['', '.js']
  },
  resolveLoader: {
    root: path.join(__dirname, 'node_modules'),
  },
  plugins: [
    new webpack.optimize.OccurenceOrderPlugin(),
    new StringReplacePlugin(),
    new webpack.DefinePlugin({
      WEBPACK_BUILD: true,
    }),
    new webpack.optimize.DedupePlugin(),
    new webpack.NoErrorsPlugin(),
  ]
}

export default options
