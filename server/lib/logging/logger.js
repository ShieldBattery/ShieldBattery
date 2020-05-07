import bunyan from 'bunyan'
import path from 'path'

import responseSerializer from './response-serializer'

const logLevels = JSON.parse(process.env.SB_LOG_LEVELS)

export default bunyan.createLogger({
  name: 'manner-pylon',
  serializers: {
    err: bunyan.stdSerializers.err,
    req: bunyan.stdSerializers.req,
    res: responseSerializer,
  },

  streams: [
    { stream: process.stdout, level: logLevels.console },
    {
      type: 'rotating-file',
      path: path.join(path.resolve(__dirname, '..', '..'), 'logs', 'manner-pylon.log'),
      period: '1d',
      count: 7,
      level: logLevels.file,
    },
  ],
})
