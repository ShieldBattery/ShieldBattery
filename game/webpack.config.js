import path from 'path'
import webpack from 'webpack'
import StringReplacePlugin from 'string-replace-webpack-plugin'

const entry = path.resolve(__dirname, 'index.js')

const options = {
  entry,
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
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
  devtool: 'hidden-source-map',
  resolve: {
    extensions: ['', '.js']
  },
  plugins: [
    new webpack.NormalModuleReplacementPlugin(
        /[\\/]any-promise[\\/]/, require.resolve('../common/promise.js')),
    new webpack.IgnorePlugin(/README\.md|LICENSE$/),
    new webpack.optimize.OccurenceOrderPlugin(),
    new StringReplacePlugin(),
    new webpack.optimize.DedupePlugin(),
    new webpack.NoErrorsPlugin(),
  ]
}

export default options
