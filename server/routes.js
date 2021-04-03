import koaConvert from 'koa-convert'
import koaStatic from 'koa-static'
import KoaRouter from '@koa/router'
import httpErrors from 'http-errors'
import path from 'path'
import fs from 'fs'
import logger from './lib/logging/logger'
import { getCspNonce } from './lib/security/csp'
import { getUrl, readFile } from './lib/file-upload'
import yaml from 'js-yaml'
import { monotonicNow } from './lib/time/monotonic-now'

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

  // NOTE(tec27): This used to send our feedback URL to clients. Leaving it in place for now to
  // not break those clients on launch, can be deleted later on.
  router.get('/config', async (ctx, next) => {
    ctx.body = {}
    ctx.type = 'application/json'
  })

  router.get('/installer.msi', async (ctx, next) => {
    ctx.set('Location', '/download')
    ctx.status = 301
  })

  const MAX_INSTALLER_CACHE_TIME = 5 * 60 * 1000
  let cachedInstallerUrl
  let installerUrlTime = 0

  // NOTE(tec27): This is where we redirect downloads to, since we don't know what the current
  // exe path is. It maps to where we *used to* upload these files to manually.
  router.get('/published_artifacts/win/ShieldBattery.latest.exe', async ctx => {
    const curTime = monotonicNow()
    if (!cachedInstallerUrl || curTime - installerUrlTime > MAX_INSTALLER_CACHE_TIME) {
      const updateYaml = await readFile('app/latest.yml')
      const parsed = yaml.load(updateYaml)

      if (!parsed.path) {
        throw new Error('Could not find file path on update YAML')
      }
      if (!parsed.releaseDate) {
        throw new Error('Could not find release date on update YAML')
      }

      cachedInstallerUrl =
        (await getUrl(`app/${parsed.path}`, false /* signUrl */)) +
        `?${encodeURIComponent(parsed.releaseDate)}`
      installerUrlTime = curTime
    }

    ctx.set('Location', cachedInstallerUrl)
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
        cspNonce: getCspNonce(ctx),
      })
    },
  )
}
