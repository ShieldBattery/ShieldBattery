import webpack from 'webpack'
import config from './webpack.config.js'

const devConfig = {
  ...config,
  devtool: 'cheap-module-eval-source-map',
  plugins: [
    ...config.plugins.slice(2) /* remove ModuleConcatenationPlugin, production define */,
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
    }),
  ],
}

export default devConfig
