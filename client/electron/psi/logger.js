import path from 'path'
import logger from '../../../common/logger'
import { remote } from 'electron'


const dataRoot = remote.app.getPath('userData')
const logFile = path.join(dataRoot, 'logs', 'psi')
// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
