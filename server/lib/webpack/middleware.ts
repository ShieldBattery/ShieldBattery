import { ServerResponse } from 'http'
import { Middleware } from 'koa'
import { Compiler } from 'webpack'
import webpackDevMiddleware, { Options } from 'webpack-dev-middleware'

export interface WebpackMiddlewareOptions {
  compiler: Compiler
  devMiddleware: Options
}

export function webpackMiddleware({
  compiler,
  devMiddleware,
}: Partial<WebpackMiddlewareOptions>): Middleware {
  if (!compiler) {
    throw new Error('compiler must be specified')
  }

  devMiddleware = { ...devMiddleware }

  if (!devMiddleware.publicPath) {
    devMiddleware.publicPath = compiler.options.output.path
  }

  const middleware = webpackDevMiddleware(compiler, devMiddleware)

  return async (ctx, next) => {
    // Wait for a compilation result
    const ready = new Promise<boolean>((resolve, reject) => {
      compiler.hooks.failed.tap('KoaWebpack', error => {
        reject(error)
      })

      middleware.waitUntilValid(() => {
        resolve(true)
      })
    })
    // Handle the request with webpack-dev-middleware
    const init = new Promise<void>(resolve => {
      middleware(
        ctx.req,
        ({
          end: (content: unknown) => {
            ctx.body = content
            resolve()
          },
          getHeader: ctx.get.bind(ctx),
          setHeader: ctx.set.bind(ctx),
          locals: ctx.state,
        } as any) as ServerResponse,
        () => resolve(next()),
      )
    })

    return Promise.all([ready, init])
  }
}
