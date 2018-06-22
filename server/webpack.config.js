import makeConfig from '../common.webpack.config.js'
import path from 'path'

const TARGET_BROWSERS = 'last 2 versions'

const webpackOpts = {
  // Relative to the root directory
  name: 'server',
  entry: ['./client/index.jsx'],
  output: {
    filename: 'client.js',
    path: path.join(__dirname, 'public', 'scripts'),
    publicPath: '/scripts/',
  },
  plugins: [],
  resolve: {
    // Look for modules and loaders in server's node_modules directory, instead of client's
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
    process.env.NODE_ENV !== 'production' ? ['react-hot-loader/babel'] : [],
  ),
}

export default makeConfig({
  webpack: webpackOpts,
  babel: babelOpts,
  globalDefines: {
    IS_ELECTRON: false,
  },
  minify: true,
})
