import * as path from 'node:path'
import logger from './create-logger.js'
import { getUserDataPath } from './user-data-path.js'

const logFile = path.join(getUserDataPath(), 'logs', 'app')
// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: ['verbose', 'info', 'debug', 'warning', 'error'] })
