import path from 'path'
import logger from '../../app/common/logger'
const dataRoot = process.env.AppData ?
    path.join(process.env.AppData, 'ShieldBattery') :
    path.dirname(path.dirname(path.resolve(process.argv[1])))
const logFile = path.join(dataRoot, 'logs', 'shieldbattery')

// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
