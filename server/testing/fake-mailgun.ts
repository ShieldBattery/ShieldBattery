// An extremely basic implementation of the mailgun API (well, the parts we actually use) that
// allows sent emails to be retrieved in integration tests.
import KoaRouter from '@koa/router'
import http from 'http'
import httpErrors from 'http-errors'
import Koa from 'koa'
import koaBody from 'koa-body'
import { SentEmail } from './sent-email'

const port = Number(process.env.FAKE_MAILGUN_PORT ?? 5528)

const app = new Koa()

app.use(koaBody({ multipart: true }))
app.use(async (ctx, next) => {
  console.log(
    `--> ${ctx.method} ${ctx.url}\n${JSON.stringify(ctx.request.headers)}\n${JSON.stringify(
      ctx.request.body,
    )}`,
  )
  await next()
  console.log(`<-- ${ctx.method} ${ctx.url} ${ctx.status}`)
})

const router = new KoaRouter()

const sentMessages = new Map<string, SentEmail[]>()
/** Template name -> version tag -> template content. */
const templates = new Map<string, Map<string, string>>()

function templateVersionResponse(templateName: string, versionCode: string, content: string) {
  return { template: { name: templateName, version: { tag: versionCode, template: content } } }
}

router
  .post('/v3/:domain/messages', async ctx => {
    const body = (ctx.request.body ?? {}) as Record<string, string>
    const { to, from, subject, template } = body
    const version = body['t:version']
    const templateVariables = body['t:variables'] ? JSON.parse(body['t:variables']) : undefined
    if (!to || !from || !subject || !template || !version || !templateVariables) {
      throw new httpErrors.BadRequest('Missing required fields')
    }
    if (!templates.get(template)?.has(version)) {
      throw new httpErrors.BadRequest(`Template ${template} has no version ${version}`)
    }

    if (!sentMessages.has(to)) {
      sentMessages.set(to, [])
    }
    sentMessages.get(to)!.unshift({ to, from, subject, template, version, templateVariables })

    ctx.status = 200
    ctx.body = { message: 'Queued. Thank you.', id: '<123@example.org>' }
  })
  .get('/v3/:domain/templates/:templateName', async ctx => {
    const { templateName } = ctx.params
    if (!templates.has(templateName)) {
      throw new httpErrors.NotFound('template not found')
    }
    ctx.body = { template: { name: templateName } }
  })
  .post('/v3/:domain/templates', async ctx => {
    const { name, tag, template } = (ctx.request.body ?? {}) as Record<string, string>
    if (!name || !tag || !template) {
      throw new httpErrors.BadRequest('Missing required fields')
    }
    if (templates.has(name)) {
      throw new httpErrors.Conflict('template already exists')
    }
    templates.set(name, new Map([[tag, template]]))
    ctx.body = templateVersionResponse(name, tag, template)
  })
  .get('/v3/:domain/templates/:templateName/versions/:versionCode', async ctx => {
    const { templateName, versionCode } = ctx.params
    const content = templates.get(templateName)?.get(versionCode)
    if (content === undefined) {
      throw new httpErrors.NotFound('template version not found')
    }
    ctx.body = templateVersionResponse(templateName, versionCode, content)
  })
  .post('/v3/:domain/templates/:templateName/versions', async ctx => {
    const { templateName } = ctx.params
    const { tag, template } = (ctx.request.body ?? {}) as Record<string, string>
    const versions = templates.get(templateName)
    if (!versions) {
      throw new httpErrors.NotFound('template not found')
    }
    if (!tag || !template) {
      throw new httpErrors.BadRequest('Missing required fields')
    }
    if (versions.has(tag)) {
      throw new httpErrors.Conflict('template version already exists')
    }
    versions.set(tag, template)
    ctx.body = templateVersionResponse(templateName, tag, template)
  })
  .put('/v3/:domain/templates/:templateName/versions/:versionCode', async ctx => {
    const { templateName, versionCode } = ctx.params
    const { template } = (ctx.request.body ?? {}) as Record<string, string>
    const versions = templates.get(templateName)
    if (!versions?.has(versionCode)) {
      throw new httpErrors.NotFound('template version not found')
    }
    if (!template) {
      throw new httpErrors.BadRequest('Missing required fields')
    }
    versions.set(versionCode, template)
    ctx.body = templateVersionResponse(templateName, versionCode, template)
  })
  .get('/sent/:to', async ctx => {
    const { to } = ctx.params

    ctx.body = sentMessages.get(to) ?? []
  })
  .delete('/sent/:to', async ctx => {
    const { to } = ctx.params
    sentMessages.delete(to)
    ctx.status = 204
  })

app.use(router.routes()).use(router.allowedMethods())

const serverCallback = app.callback()
const server = http.createServer((req, res) => {
  serverCallback(req, res).catch(err => {
    console.error(err)
  })
})
new Promise((resolve, reject) => {
  server.once('error', reject)

  server.listen(port, () => {
    server.removeListener('error', reject)
    console.log(`Fake mailgun server listening on ${port}`)
    resolve(server)
  })
}).catch(err => {
  console.error(err)
  process.exit(1)
})
