import cuid from 'cuid'
import pino, { stdSerializers } from 'pino'

export default pino(getLoggerOptions())

export function getLoggerOptions() {
  return {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    genReqId: cuid,
    serializers: stdSerializers,
  }
}
