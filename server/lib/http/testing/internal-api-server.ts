import http from 'http'
import Koa from 'koa'
import { AddressInfo } from 'net'
import { internalRoutesMiddleware } from '../../../internal-routes'
import { errorPayloadMiddleware } from '../../errors/error-payload-middleware'
import { RegisteredApi } from '../http-api'

/** The body the test server returns for any request that isn't under the internal mount. */
export const PUBLIC_ROUTE_STACK_BODY = 'public route stack'

export interface InternalApiTestServer {
  /** Origin of the listening server, e.g. `http://localhost:12345`. */
  baseUrl: string
  close(): Promise<void>
}

/**
 * Starts a real HTTP server (on an ephemeral port) running the internal-routes middleware over
 * the given API instances, with the error-payload middleware ahead of it as in the app, and a
 * stand-in public route stack behind it. Construct the API instances directly (passing fakes for
 * their dependencies) rather than resolving them from the container.
 */
export async function startInternalApiTestServer(
  apis: ReadonlyArray<RegisteredApi>,
): Promise<InternalApiTestServer> {
  const app = new Koa()
  // Swallow the error events errorPayloadMiddleware emits so expected 4xx tests don't log
  app.on('error', () => {})
  app
    .use(errorPayloadMiddleware())
    .use(internalRoutesMiddleware(apis))
    .use(ctx => {
      ctx.body = PUBLIC_ROUTE_STACK_BODY
    })

  const callback = app.callback()
  const server = http.createServer((req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    callback(req, res)
  })
  await new Promise<void>(resolve => {
    server.listen(0, resolve)
  })

  return {
    baseUrl: `http://localhost:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      }),
  }
}
