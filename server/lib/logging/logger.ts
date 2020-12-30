import pino from 'pino'
import cuid from 'cuid'

export default pino(getLoggerOptions())

export function getLoggerOptions() {
  return {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    genReqId: cuid,
  }
}
