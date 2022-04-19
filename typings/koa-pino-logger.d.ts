// NOTE(tec27): The types in the @types repo import @types/pino-http, which is outdated and causes
// issues with newer versions of pino
declare module 'koa-pino-logger' {
  import { Middleware as BaseMiddleware } from 'koa'
  import { DestinationStream, Logger } from 'pino'
  import { Options } from 'pino-http'

  interface Middleware extends BaseMiddleware {
    logger: Logger
  }

  function logger(opts?: Options, stream?: DestinationStream): Middleware
  function logger(stream?: DestinationStream): Middleware

  export default logger
}
