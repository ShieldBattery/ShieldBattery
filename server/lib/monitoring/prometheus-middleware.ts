import Koa from 'koa'
import promClient from 'prom-client'

function getMicroseconds() {
  const now = process.hrtime()
  return now[0] * 1000000 + now[1] / 1000
}

/** A middleware that responds to /metrics requests with prometheus metrics. */
export function prometheusMiddleware() {
  promClient.collectDefaultMetrics()

  return async function promMiddleware(ctx: Koa.ExtendableContext, next: Koa.Next) {
    ctx.prometheus = promClient
    if (ctx.path === '/metrics') {
      if (ctx.method.toLowerCase() === 'get') {
        if (Object.keys(ctx.headers).includes('X-Forwarded-For')) {
          // We only allow metrics retrieval through tailscale (direct access, not nginx forward)
          ctx.throw(403, 'Forbidden')
        } else {
          ctx.set('Content-Type', promClient.register.contentType)
          ctx.body = await promClient.register.metrics()
        }
      } else {
        ctx.throw(405, 'Method Not Allowed')
      }
    } else {
      await next()
    }
  }
}

/**
 * A middleware that tracks basic HTTP metrics for prometheues retrieval. This should be added as
 * early as possible in the middleware chain for accurate timings.
 */
export function prometheusHttpMetrics() {
  // TODO(tec27): add API class (and method maybe?) that gets hit? URI is too high cardinality
  // given that it contains IDs a lot of the time, but it'd be nice to have some way to track
  // individual API methods
  const labelNames = ['method', 'code']
  const httpRequestsTotal = new promClient.Counter({
    labelNames,
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
  })

  const httpServerRequestsSeconds = new promClient.Histogram({
    labelNames: ['method', 'code'],
    name: 'http_server_requests_seconds',
    help: 'Duration of HTTP requests in seconds',
    buckets: promClient.exponentialBuckets(0.05, 1.3, 20),
  })

  const httpRequestSizeBytes = new promClient.Summary({
    labelNames,
    name: 'http_request_size_bytes',
    help: 'Sum of HTTP request size in bytes',
  })

  const httpResponseSizeBytes = new promClient.Summary({
    labelNames,
    name: 'http_response_size_bytes',
    help: 'Sum of HTTP response size in bytes',
  })

  return async function httpMetricMiddleware(ctx: Koa.ExtendableContext, next: Koa.Next) {
    const startEpoch = getMicroseconds()
    await next()
    if (ctx.request.length) {
      httpRequestSizeBytes
        .labels(ctx.request.method, String(ctx.response.status))
        .observe(ctx.request.length)
    }
    if (ctx.response.length) {
      httpResponseSizeBytes
        .labels(ctx.request.method, String(ctx.response.status))
        .observe(ctx.response.length)
    }
    httpServerRequestsSeconds
      .labels(ctx.request.method, String(ctx.response.status))
      .observe((getMicroseconds() - startEpoch) / 1000000)
    httpRequestsTotal.labels(ctx.request.method, String(ctx.response.status)).inc()
  }
}
