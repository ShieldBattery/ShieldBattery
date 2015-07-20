import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import koaProxy from 'koa-pixie-proxy'
import webpackConfig from './webpack.config.js'

const DEV_SERVER_PORT = 61337

export default function(router) {
  router.get('/scripts/client.js', koaProxy({ host: `http://localhost:${DEV_SERVER_PORT}` })())
  // We expect the styles to be included in the development JS (so they can be hot reloaded)
  router.get('/styles/site.css', function*() {
    this.body = ''
  })

  const devServer = new WebpackDevServer(webpack(webpackConfig), {
    contentBase: __dirname,
    hot: true,
    quiet: false,
    noInfo: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    publicPath: '/scripts/',
  })
  devServer.listen(DEV_SERVER_PORT, 'localhost')
}
