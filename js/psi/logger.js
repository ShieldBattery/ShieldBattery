var logger = require('../util/logger')
  , path = require('path')
  , logFile = path.join(path.dirname(path.resolve(process.argv[0])), 'logs', 'psi')

// TODO(tec27): configure log levels based on build type
module.exports = logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
