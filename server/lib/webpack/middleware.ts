import { DefaultContext, Middleware } from 'koa'
import { Compiler } from 'webpack'
import wdm, { Options } from 'webpack-dev-middleware'

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

  const middleware = wdm(compiler, devMiddleware)

  const wrapper = async function webpackDevMiddleware(ctx: DefaultContext, next: any) {
    const { req, res } = ctx

    res.locals = ctx.state

    let { status } = ctx

    res.getStatusCode = () => status

    res.setStatusCode = (statusCode: number) => {
      status = statusCode
      ctx.status = statusCode
    }

    res.getReadyReadableStreamState = () => 'open'

    try {
      await new Promise<void>((resolve, reject) => {
        res.stream = (stream: ReadableStream) => {
          ctx.body = stream
        }
        res.send = (data: string | Buffer) => {
          ctx.body = data
        }

        res.finish = (data: string | Buffer) => {
          ctx.status = status
          res.end(data)
        }

        middleware(req, res, err => {
          if (err) {
            reject(err)
            return
          }

          resolve()
        })
      })
    } catch (err: any) {
      ctx.status = err.statusCode || err.status || 500
      ctx.body = {
        message: err.message,
      }
    }

    next()
  }

  wrapper.devMiddleware = devMiddleware

  return wrapper
}
