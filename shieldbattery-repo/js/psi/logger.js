import path from 'path'
import logger from '../util/logger'

const dataRoot = process.env.ProgramData ?
    path.join(process.env.ProgramData, 'shieldbattery') :
    path.dirname(path.resolve(process.argv[0]))
const logFile = path.join(dataRoot, 'logs', 'psi')
// TODO(tec27): configure log levels based on build type
export default logger(logFile, { logLevels: [ 'verbose', 'debug', 'warning', 'error' ] })
