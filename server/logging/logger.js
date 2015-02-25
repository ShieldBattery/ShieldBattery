var bunyan = require('bunyan')
  , config = require('../../config.js')
  , path = require('path')

module.exports = bunyan.createLogger({
  name: 'manner-pylon',
  serializers: {
    err: bunyan.stdSerializers.err,
    req: bunyan.stdSerializers.req, 
    res: require('./response-serializer')
  },

  streams: [
    { stream: process.stdout, level: config.logLevels.console },
    {
      type: 'rotating-file',
      path: path.join(path.resolve(__dirname, '..', '..'), 'logs', 'manner-pylon.log'), 
      period: '1d',
      count: 7
    }
  ]
})
