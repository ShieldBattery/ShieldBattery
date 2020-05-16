// Passes log messages to the main process over IPC so they can be saved to a joint log file. This
// is safe to include in browser code (it will just no-op)

import { LOG_MESSAGE } from '../../common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : { send: () => {} }

const log = (level, msg) => ipcRenderer.send(LOG_MESSAGE, level, msg)
const logger = {
  verbose: log.bind(undefined, 'verbose'),
  debug: log.bind(undefined, 'debug'),
  warning: log.bind(undefined, 'warning'),
  error: log.bind(undefined, 'error'),
}

export default logger
