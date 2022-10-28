import cuid from 'cuid'
import pino, { stdSerializers } from 'pino'

const STDOUT_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug'

const transport = pino.transport({
  targets: process.env.SB_DATADOG_KEY
    ? [
        {
          target: 'pino-datadog-transport',
          options: {
            ddClientConf: {
              authMethods: {
                apiKeyAuth: process.env.SB_DATADOG_KEY,
              },
            },
          },
          level: 'info',
        },
        // Log to stdout
        { target: 'pino/file', options: {}, level: STDOUT_LEVEL },
      ]
    : [{ target: 'pino/file', options: {}, level: STDOUT_LEVEL }],
})

export default pino(getLoggerOptions(), transport)

export function getLoggerOptions() {
  return {
    genReqId: cuid,
    serializers: stdSerializers,
    // Make sure pino-http doesn't re-wrap these since we're specifying the serializers already
    wrapSerializers: false,
  }
}

export function getLoggerTransports() {
  return transport
}
