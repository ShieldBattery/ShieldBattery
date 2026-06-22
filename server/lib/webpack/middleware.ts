import { Middleware } from 'koa'
import { Compiler } from 'webpack'
import webpackDevMiddleware, { Options } from 'webpack-dev-middleware'
import hotMiddleware from 'webpack-hot-middleware'

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

  const options = { ...devMiddleware }

  if (!options.publicPath) {
    options.publicPath = compiler.options.output.path
  }

  const middleware = webpackDevMiddleware(compiler, options)

  return async (ctx, next) => {
    const { req, res } = ctx

    ;(res as any).locals = ctx.state
    ;(res as any).getStatusCode = () => ctx.status
    ;(res as any).setStatusCode = (code: number) => {
      ctx.status = code
    }
    ;(res as any).getReadyReadableStreamState = () => 'open'

    await new Promise((resolve, reject) => {
      // webpack-dev-middleware ends a successful response purely through these pseudo-API hooks
      // (it doesn't call the `next` callback below in that case), so we have to resolve here once
      // the body has been handed off.
      ;(res as any).stream = (stream: any) => {
        ctx.body = stream
        resolve(undefined)
      }
      ;(res as any).send = (data: any) => {
        ctx.body = data
        resolve(undefined)
      }
      ;(res as any).finish = (data?: any) => {
        if (data !== undefined) {
          ctx.body = data
        }
        resolve(undefined)
      }

      middleware(req, res, (err?: Error) => {
        // We only reach here on fallthrough (unaccepted method / 404 / file not found), i.e. when
        // the middleware didn't serve a response itself, so defer to the next Koa middleware.
        if (err) {
          reject(err)
        } else {
          resolve(next())
        }
      }).catch((err: Error) => {
        reject(err)
      })
    })
  }
}

export function webpackHotMiddleware(compiler: Compiler): Middleware {
  const middleware = hotMiddleware(compiler)

  return async (ctx, next) => {
    const { req, res } = ctx

    ;(res as any).locals = ctx.state
    ;(res as any).getStatusCode = () => ctx.status
    ;(res as any).setStatusCode = (code: number) => {
      ctx.status = code
    }
    ;(res as any).getReadyReadableStreamState = () => 'open'

    let hadData = false
    await new Promise((resolve, reject) => {
      ;(res as any).stream = (stream: any) => {
        ctx.body = stream
        hadData = true
      }
      ;(res as any).send = (data: any) => {
        ctx.body = data
        hadData = true
      }
      ;(res as any).finish = (data: any) => {
        ctx.body = data
        hadData = true
      }

      middleware(req, res, (err?: Error) => {
        if (err) {
          reject(err)
        } else {
          if (!hadData) {
            resolve(next())
          } else {
            resolve(undefined)
          }
        }
      })
    })
  }
}
