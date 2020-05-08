import pino from 'pino'
import { stdSerializers } from 'pino-http'
import cuid from 'cuid'

export default pino(getLoggerOptions())

export function getLoggerOptions() {
  return {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    genReqId: cuid,
    serializers: stdSerializers,
  }
}
