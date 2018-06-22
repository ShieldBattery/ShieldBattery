import path from 'path'
import webpack from 'webpack'
import StringReplacePlugin from 'string-replace-webpack-plugin'

const entry = path.resolve(__dirname, 'index.js')

const options = {
  entry,
  mode: 'production',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
  },
  module: {
    rules: [
      // Work around an issue with json-schema doing a weird AMD check and being broken in webpack
      {
        test: /validate.js$/,
        include: /node_modules(\\|\/)json-schema/,
        use: StringReplacePlugin.replace({
          replacements: [
            {
              pattern: /\(\{define:typeof define!="undefined"\?define:function\(deps, factory\)\{module\.exports = factory\(\);\}\}\)\./gi, // eslint-disable-line max-len
              replacement(match, p1, offset, string) {
                return ''
              },
            },
          ],
        })
          .split('!')
          .map(name => ({ loader: name })),
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              babelrc: false,
              cacheDirectory: true,
              presets: [
                [
                  'env',
                  {
                    targets: { node: '7.4' },
                    modules: false,
                    useBuiltIns: true,
                  },
                ],
                'stage-0',
              ],
              plugins: ['transform-decorators-legacy'],
            },
          },
        ],
      },
      {
        test: /shaders.+\..+sl$/,
        exclude: /node_modules/,
        use: [{ loader: 'raw-loader' }],
      },
    ],
  },
  devtool: 'hidden-source-map',
  optimization: {
    noEmitOnErrors: true,
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]any-promise[\\/]/,
      require.resolve('../app/common/promise.js'),
    ),
    new webpack.IgnorePlugin(/README\.md$|LICENSE$/),
    new StringReplacePlugin(),
  ],
}

export default options
