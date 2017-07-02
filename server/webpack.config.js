import makeConfig from '../common.webpack.config.js'
import path from 'path'

const TARGET_BROWSERS = 'last 2 versions'

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
    modules: [path.join(__dirname, 'node_modules'), 'node_modules'],
  },
}
const babelOpts = {
  babelrc: false,
  cacheDirectory: true,
  // Note that these need to be installed in the root package.json, not the server one
  presets: [
    'react',
    [
      'env',
      {
        targets: { browsers: TARGET_BROWSERS },
        modules: false,
        useBuiltIns: true,
      },
    ],
    'stage-0',
  ],
  plugins: ['transform-decorators-legacy'].concat(
    process.env.NODE_ENV !== 'production'
      ? [
          // Need these to work around an issue in react-transform/react-hot-loader:
          // https://github.com/gaearon/react-hot-loader/issues/313
          'transform-class-properties',
          'transform-es2015-classes',

          [
            'react-transform',
            {
              transforms: [
                {
                  transform: 'react-transform-hmr',
                  imports: ['react'],
                  locals: ['module'],
                },
                {
                  transform: 'react-transform-catch-errors',
                  imports: ['react', 'redbox-react'],
                },
              ],
            },
          ],
        ]
      : [],
  ),
}

export default makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  hotUrl: 'webpack-hot-middleware/client',
  envDefines: { SB_ENV: JSON.stringify('web') },
  minify: true,
})
