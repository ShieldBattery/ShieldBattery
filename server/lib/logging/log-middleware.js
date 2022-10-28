import koaPino from 'koa-pino-logger'
import { getLoggerOptions, getLoggerTransports } from './logger'

export default function logMiddleware() {
  return koaPino(getLoggerOptions(), getLoggerTransports())
}
