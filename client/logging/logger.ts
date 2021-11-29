import { TypedIpcRenderer } from '../../common/ipc'

const ipcRenderer = new TypedIpcRenderer()

function log(level: string, msg: string) {
  ipcRenderer.invoke('logMessage', level, msg)
}

export const logger = {
  verbose: log.bind(undefined, 'verbose'),
  debug: log.bind(undefined, 'debug'),
  warning: log.bind(undefined, 'warning'),
  error: log.bind(undefined, 'error'),
}

export default logger
