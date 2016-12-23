import path from 'path'
import webpack from 'webpack'
import config from './webpack.config.js'

const devConfig = {
  ...config,
  output: {
    path: path.resolve(__dirname, '../js'),
    filename: 'index.js'
  },
  devtool: 'sourcemap',
  plugins: [
    ...config.plugins,
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development')
    }),
  ],
}

export default devConfig
