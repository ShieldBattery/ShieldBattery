const PORT = 5566

import express from 'express'
import webpack from 'webpack'
import webpackDevMiddleware from 'webpack-dev-middleware'
import webpackHotMiddleware from 'webpack-hot-middleware'

import config from './webpack.config'

const app = express()
const compiler = webpack(config)

const middleware = webpackDevMiddleware(compiler, {
  logLevel: 'warn',
  publicPath: config.output.publicPath,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
  },
})
app.use(middleware)
app.use(webpackHotMiddleware(compiler, { log: console.log }))

const server = app.listen(PORT, 'localhost', err => {
  if (err) {
    console.error(err)
    return
  }

  console.log(`Listening at http://localhost:${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('Stopping electron dev server')
  middleware.close()
  server.close(() => {
    process.exit(0)
  })
})
