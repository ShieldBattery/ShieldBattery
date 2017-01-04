import webpack from 'webpack'
import config from './webpack.config.js'

const devConfig = {
  ...config,
  devtool: 'cheap-module-eval-source-map',
  plugins: [
    ...config.plugins,
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development')
    }),
  ],
}

export default devConfig
