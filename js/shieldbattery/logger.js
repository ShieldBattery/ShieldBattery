const logger = require('../util/logger')
const path = require('path')
const shieldbatteryDir = path.dirname(path.dirname(
    path.resolve(process.argv[process.argv.length - 2])))
const logFile = path.join(shieldbatteryDir, 'logs', 'shieldbattery')

// TODO(tec27): configure log levels based on build type
module.exports = logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
