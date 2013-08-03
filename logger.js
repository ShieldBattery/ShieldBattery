var bunyan = require('bunyan')
  , config = require('./config.js')
  , path = require('path')

var log = module.exports = bunyan.createLogger(
    { name: 'manner-pylon'
    , serializers:
        { err: bunyan.stdSerializers.err
        , req: bunyan.stdSerializers.req
        , res: require('./util/response-serializer')
        }
    , streams:
        [ { stream: process.stdout
          , level: config.logLevels.console
          }
        , { type: 'rotating-file'
          , path: path.join(__dirname, 'logs', 'manner-pylon.log')
          , period: '1d'
          , count: 7
          }
        ]
    })
