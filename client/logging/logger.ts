import { TypedIpcRenderer } from '../../common/ipc'

const ipcRenderer = new TypedIpcRenderer()

function log(level: string, msg: string) {
  ipcRenderer.invoke('logMessage', level, msg)?.catch(err => {
    console.error(`Error logging message: ${err?.stack ?? err}`)
  })

  if (level === 'error') {
    console.error(`[ERROR]: ${msg}`)
  } else {
    console.log(`[${level.toUpperCase()}]: ${msg}`)
  }
}

export const logger = {
  verbose: log.bind(undefined, 'verbose'),
  debug: log.bind(undefined, 'debug'),
  warning: log.bind(undefined, 'warning'),
  error: log.bind(undefined, 'error'),
}

export default logger
