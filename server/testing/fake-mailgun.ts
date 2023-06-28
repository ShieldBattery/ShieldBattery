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

router
  .post('/v3/:domain/messages', async ctx => {
    // TODO(tec27): remove text and only allow templates once all the templates are migrated
    const { to, from, subject, text, template } = ctx.request.body
    const templateVariables = ctx.request.body['t:variables']
      ? JSON.parse(ctx.request.body['t:variables'])
      : undefined
    if (!to || !from || !subject || (!text && !(template && templateVariables))) {
      throw new httpErrors.BadRequest('Missing required fields')
    }

    if (!sentMessages.has(to)) {
      sentMessages.set(to, [])
    }
    sentMessages.get(to)!.unshift({ to, from, subject, text, template, templateVariables })

    ctx.status = 200
    ctx.body = { message: 'Queued. Thank you.', id: '<123@example.org>' }
  })
  .get('/v3/:domain/templates/:templateName/versions/:versionCode', async ctx => {
    // Just act like all the templates exist, we're not trying to catch template issues with these
    // tests
    ctx.status = 200
    ctx.body = {}
  })
  .get('/sent/:to', async ctx => {
    const { to } = ctx.params

    ctx.body = sentMessages.get(to) ?? []
  })

app.use(router.routes()).use(router.allowedMethods())

const server = http.createServer(app.callback())
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
