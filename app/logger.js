import path from 'path'
import logger from './common/logger'
import { getUserDataPath } from './user-data-path'

const logFile = path.join(getUserDataPath(), 'logs', 'app')
// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: ['verbose', 'info', 'debug', 'warning', 'error'] })
