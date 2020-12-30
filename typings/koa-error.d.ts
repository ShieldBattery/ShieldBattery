declare module 'koa-error' {
  import * as Koa from 'koa'

  // TODO(tec27): make some real typings for this
  export default function koaError(): Koa.Middleware
}
