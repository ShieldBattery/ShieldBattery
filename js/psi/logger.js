import path from 'path'
import logger from '../util/logger'

const logFile = path.join(path.dirname(path.resolve(process.argv[0])), 'logs', 'psi')
// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
