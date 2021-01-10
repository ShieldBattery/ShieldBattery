import koaConvert from 'koa-convert'
import koaStatic from 'koa-static'
import KoaRouter from '@koa/router'
import httpErrors from 'http-errors'
import path from 'path'
import fs from 'fs'
import logger from './lib/logging/logger'
import { getCspNonce } from './lib/security/csp'

const router = KoaRouter()
const jsOrTsFileMatcher = RegExp.prototype.test.bind(/\.(js|ts)$/)

function send404(ctx, next) {
  throw new httpErrors.NotFound()
}

export default function applyRoutes(app, websocketServer) {
  app.use(router.routes()).use(router.allowedMethods())

  // api methods (through HTTP)
  const apiFiles = fs.readdirSync(path.join(__dirname, 'lib', 'api'))
  const baseApiPath = '/api/1/'
  apiFiles.filter(jsOrTsFileMatcher).forEach(filename => {
    const apiPath = baseApiPath + path.basename(filename, path.extname(filename))
    const subRouter = new KoaRouter()
    require('./lib/api/' + filename).default(subRouter, websocketServer)
    router.use(apiPath, subRouter.routes())
    logger.info('mounted ' + apiPath)
  })
  // error out on any API URIs that haven't been explicitly handled, so that we don't end up
  // sending back HTML due to the wildcard rule below
  router.all('/api/:param*', send404)

  // common requests that we don't want to return the regular page for
  // TODO(tec27): we should probably do something based on expected content type as well
  router.get('/robots.txt', send404).get('/favicon.ico', send404)

  router.get('/config', async (ctx, next) => {
    ctx.body = {
      feedbackUrl: process.env.SB_FEEDBACK_URL,
    }
    ctx.type = 'application/json'
  })

  router.get('/installer.msi', async (ctx, next) => {
    ctx.set('Location', '/download')
    ctx.status = 301
  })

  // catch-all for the remainder, first tries static files, then if not found, renders the index and
  // expects the client to handle routing
  router.get(
    '/:param*',
    koaConvert(koaStatic(path.join(__dirname, 'public'))),
    async (ctx, next) => {
      const initData = {}
      if (ctx.session.userId) {
        initData.auth = {
          user: {
            id: ctx.session.userId,
            name: ctx.session.userName,
            emailVerified: ctx.session.emailVerified,
          },
          permissions: ctx.session.permissions,
        }
      }
      await ctx.render('index', {
        initData,
        feedbackUrl: process.env.SB_FEEDBACK_URL,
        cspNonce: getCspNonce(ctx),
      })
    },
  )
}
