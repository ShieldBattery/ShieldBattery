import bunyan from 'bunyan'
import config from '../../config.js'
import path from 'path'

import responseSerializer from './response-serializer'

export default bunyan.createLogger({
  name: 'manner-pylon',
  serializers: {
    err: bunyan.stdSerializers.err,
    req: bunyan.stdSerializers.req,
    res: responseSerializer,
  },

  streams: [
    { stream: process.stdout, level: config.logLevels.console },
    {
      type: 'rotating-file',
      path: path.join(path.resolve(__dirname, '..', '..'), 'logs', 'manner-pylon.log'),
      period: '1d',
      count: 7,
    },
  ],
})
