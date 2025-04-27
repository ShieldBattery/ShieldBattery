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
      }).catch((err: Error) => {
        reject(err)
      })
    })
  }
}
