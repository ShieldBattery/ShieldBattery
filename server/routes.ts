import KoaRouter, { RouterContext } from '@koa/router'
import fs from 'fs'
import httpErrors from 'http-errors'
import yaml from 'js-yaml'
import Koa from 'koa'
import koaConvert from 'koa-convert'
import koaStatic from 'koa-static'
import path from 'path'
import { ServerConfig } from '../common/server-config'
import { ClientSessionInfo } from '../common/users/session'
import './http-apis'
import { getUrl, readFile } from './lib/file-upload'
import { applyApiRoutes, resolveAllHttpApis } from './lib/http/http-api'
import logger from './lib/logging/logger'
import { getCspNonce } from './lib/security/csp'
import { monotonicNow } from './lib/time/monotonic-now'
import { WebsocketServer } from './websockets'

const jsOrTsFileMatcher = RegExp.prototype.test.bind(/\.(js|ts)$/)

function send404() {
  throw new httpErrors.NotFound()
}

interface LatestYaml {
  path: string
  releaseDate: string
}

export default function applyRoutes(app: Koa, websocketServer: WebsocketServer) {
  const router = new KoaRouter()
  app.use(router.routes()).use(router.allowedMethods())

  // injected API handlers
  const httpApis = resolveAllHttpApis()
  for (const httpApi of httpApis) {
    applyApiRoutes(router, httpApi)
  }

  // api methods (through HTTP)
  // TODO(tec27): migrate these to injected HttpApis
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

  let publicAssetsUrl: string
  const fileStoreSettings = JSON.parse(process.env.SB_FILE_STORE!)
  if (fileStoreSettings.doSpaces) {
    const settings = fileStoreSettings.doSpaces
    publicAssetsUrl = settings.cdnHost
      ? `https://${settings.cdnHost}/public/`
      : `https://${settings.bucket}.${settings.endpoint}/public/`
  } else {
    publicAssetsUrl = '/'
  }

  const serverConfig: ServerConfig = {
    publicAssetsUrl,
  }

  router.get('/config', async ctx => {
    ctx.body = serverConfig
    ctx.type = 'application/json'
  })

  router.get('/installer.msi', async ctx => {
    ctx.set('Location', '/download')
    ctx.status = 301
  })

  const MAX_INSTALLER_CACHE_TIME = 5 * 60 * 1000
  let cachedInstallerUrl: string | undefined
  let installerUrlTime = 0

  // NOTE(tec27): This is where we redirect downloads to, since we don't know what the current
  // exe path is. It maps to where we *used to* upload these files to manually.
  router.get('/published_artifacts/win/ShieldBattery.latest.exe', async ctx => {
    const curTime = monotonicNow()
    if (!cachedInstallerUrl || curTime - installerUrlTime > MAX_INSTALLER_CACHE_TIME) {
      const updateYaml = await readFile('app/latest.yml')
      const parsed = yaml.load(updateYaml.toString('utf8')) as Partial<LatestYaml>

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
    async (ctx: RouterContext) => {
      const initData: { serverConfig: ServerConfig; session?: ClientSessionInfo } = {
        serverConfig,
      }
      if (ctx.session?.userId) {
        initData.session = {
          user: {
            id: ctx.session.userId,
            name: ctx.session.userName,
            email: ctx.session.email,
            emailVerified: ctx.session.emailVerified,
            acceptedPrivacyVersion: ctx.session.acceptedPrivacyVersion,
            acceptedTermsVersion: ctx.session.acceptedTermsVersion,
            acceptedUsePolicyVersion: ctx.session.acceptedUsePolicyVersion,
          },
          permissions: ctx.session.permissions,
          lastQueuedMatchmakingType: ctx.session.lastQueuedMatchmakingType,
        }
      }
      await ctx.render('index', {
        initData,
        cspNonce: getCspNonce(ctx),
        analyticsId: process.env.SB_ANALYTICS_ID,
      })
    },
  )
}
