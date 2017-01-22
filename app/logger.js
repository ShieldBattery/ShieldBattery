import path from 'path'
import logger from '../common/logger'
import { app } from 'electron'

// TODO(tec27): combine this log with the one in client/ (through RPCs to the electron process)
const dataRoot = app.getPath('userData')
const logFile = path.join(dataRoot, 'logs', 'app')
// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
