import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import koaProxy from 'koa-pixie-proxy'
import webpackConfig from './webpack.config.js'

const DEV_SERVER_PORT = 61337

export default function(router) {
  router.get('/scripts/client.js', koaProxy({ host: `http://localhost:${DEV_SERVER_PORT}` })(),
      function* catchBodySet(next) {
        // Stop the chain of middlewares if the body has been set, so that later middlewares don't
        // overwrite it with e.g. the compiled/production javascript
        if (this.body) return
        else yield next
      })
  // We expect the styles to be included in the development JS (so they can be hot reloaded)
  router.get('/styles/site.css', function*() {
    this.body = ''
    this.type = 'text/css'
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
