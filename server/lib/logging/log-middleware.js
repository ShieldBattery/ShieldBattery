import koaPino from 'koa-pino-logger'
import { getLoggerOptions, getLoggerTransports } from './logger.js'

export default function logMiddleware() {
  return koaPino(getLoggerOptions(), getLoggerTransports())
}
