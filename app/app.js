import { getUserDataPath } from './user-data-path'
getUserDataPath()

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import isDev from 'electron-is-dev'
import logger from './logger'

app.setAppUserModelId('net.shieldbattery.client')

import url from 'url'
import LocalSettings from './local-settings'
import currentSession from './current-session'
import { autoUpdater } from 'electron-updater'
import {
  LOG_MESSAGE,
  NETWORK_SITE_CONNECTED,
  NEW_VERSION_DOWNLOAD_ERROR,
  NEW_VERSION_DOWNLOADED,
  NEW_VERSION_FOUND,
  NEW_VERSION_GET_STATE,
  NEW_VERSION_RESTART,
  NEW_VERSION_UP_TO_DATE,
  SETTINGS_CHANGED,
  SETTINGS_EMIT,
  SETTINGS_EMIT_ERROR,
  SETTINGS_MERGE,
  SETTINGS_MERGE_ERROR,
  UPDATE_SERVER,
  UPDATE_SERVER_COMPLETE,
  WINDOW_CLOSE,
  WINDOW_MAXIMIZE,
  WINDOW_MINIMIZE,
} from './common/ipc-constants'

autoUpdater.logger = logger

// Keep a reference to the window object so that it doesn't get GC'd and closed
let mainWindow

function applyOriginFilter(curSession, baseUrl) {
  // Modify the origin for all ShieldBattery server requests
  const filter = {
    urls: [`${baseUrl}/*`]
  }
  curSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders.Origin = 'http://client.shieldbattery.net'
    callback({ cancel: false, requestHeaders: details.requestHeaders })
  })
}

async function installDevExtensions() {
  if (isDev) {
    const installer = require('electron-devtools-installer')
    const extensions = [
      'REACT_DEVELOPER_TOOLS',
      'REDUX_DEVTOOLS',
    ]
    return Promise.all(extensions.map(name => installer.default(installer[name])))
  }

  return null
}

async function createLocalSettings() {
  const settings = new LocalSettings(path.join(getUserDataPath(), 'settings.json'))
  await settings.untilInitialized()
  return settings
}

function setupIpc(localSettings) {
  ipcMain.on(LOG_MESSAGE, (event, level, message) => { logger.log(level, message) })
  ipcMain.on(UPDATE_SERVER, (event, serverUrl) => {
    applyOriginFilter(currentSession(), serverUrl)
    event.sender.send(UPDATE_SERVER_COMPLETE)
  })

  ipcMain.on(SETTINGS_EMIT, event => {
    localSettings.get().then(settings => event.sender.send(SETTINGS_CHANGED, settings),
        err => {
          logger.error('Error getting settings: ' + err)
          event.sender.send(SETTINGS_EMIT_ERROR, err)
        })
  }).on(SETTINGS_MERGE, (event, settings) => {
    // This will trigger a change if things changed (which will then emit a SETTINGS_CHANGED)
    localSettings.merge(settings).catch(err => {
      logger.error('Error merging settings: ' + err)
      event.sender.send(SETTINGS_MERGE_ERROR, err)
    })
  }).on(WINDOW_CLOSE, event => {
    if (!mainWindow) {
      return
    }
    mainWindow.close()
  }).on(WINDOW_MAXIMIZE, event => {
    if (!mainWindow) {
      return
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }).on(WINDOW_MINIMIZE, event => {
    if (!mainWindow) {
      return
    }
    mainWindow.minimize()
  })

  localSettings.on(LocalSettings.EVENT, settings => {
    if (mainWindow) {
      mainWindow.webContents.send(SETTINGS_CHANGED, settings)
    }
  })

  let updateState = NEW_VERSION_UP_TO_DATE
  const sendUpdateState = () => {
    if (mainWindow) {
      mainWindow.webContents.send(updateState)
    }
  }
  autoUpdater.on('update-available', () => {
    updateState = NEW_VERSION_FOUND
    sendUpdateState()
  }).on('update-not-available', () => {
    updateState = NEW_VERSION_UP_TO_DATE
    sendUpdateState()
  }).on('update-downloaded', () => {
    updateState = NEW_VERSION_DOWNLOADED
    sendUpdateState()
  }).on('error', () => {
    if (updateState === NEW_VERSION_FOUND) {
      updateState = NEW_VERSION_DOWNLOAD_ERROR
      sendUpdateState()
    }
  })

  ipcMain.on(NEW_VERSION_RESTART, () => {
    autoUpdater.quitAndInstall()
  }).on(NEW_VERSION_GET_STATE, event => {
    event.sender.send(updateState)
  })

  if (!isDev) {
    ipcMain.on(NETWORK_SITE_CONNECTED, () => {
      autoUpdater.checkForUpdates()
    })
  }
}


async function createWindow(localSettings, curSession) {
  // TODO(tec27): verify that window positioning is still valid on current monitor setup
  const {
    winX,
    winY,
    winWidth,
    winHeight,
    winMaximized
  } = await localSettings.get()
  mainWindow = new BrowserWindow({
    width: winWidth && winWidth > 0 ? winWidth : 1024,
    height: winHeight && winHeight > 0 ? winHeight : 768,
    x: winX && winX !== -1 ? winX : undefined,
    y: winY && winY !== -1 ? winY : undefined,

    acceptFirstMouse: true,
    backgroundColor: '#303030',
    frame: false,
    show: false,
    title: 'ShieldBattery',
    webPreferences: {
      session: curSession,
    },
  })

  if (winMaximized) {
    mainWindow.maximize()
  }

  let debounceTimer = null
  const handleResizeOrMove = () => {
    debounceTimer = null
    if (!mainWindow || mainWindow.isMaximized()) {
      return
    }
    const {
      x: winX,
      y: winY,
      width: winWidth,
      height: winHeight,
    } = mainWindow.getBounds()
    localSettings.merge({ winX, winY, winWidth, winHeight }).catch(err => {
      logger.error('Error saving new window bounds: ' + err)
    })
  }

  mainWindow.on('maximize', () => {
    localSettings.merge({ winMaximized: true }).catch(err => {
      logger.error('Error saving new window maximized state: ' + err)
    })
  }).on('unmaximize', () => {
    localSettings.merge({ winMaximized: false }).catch(err => {
      logger.error('Error saving new window maximized state: ' + err)
    })
  }).on('resize', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(handleResizeOrMove, 100)
  }).on('move', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(handleResizeOrMove, 100)
  })

  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault()
    shell.openExternal(url)
  })

  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true
  }))

  mainWindow.once('ready-to-show', () => { mainWindow.show() })
  // TODO(tec27): only do this in dev mode :)
  mainWindow.webContents.openDevTools()

  mainWindow.on('closed', () => { mainWindow = null })
}

app.on('ready', async () => {
  const devExtensionsPromise = installDevExtensions()
  const localSettingsPromise = createLocalSettings()

  if (!isDev) {
    setInterval(() => {
      // TODO(tec27): trigger another update check when the websocket reconnects to the server
      autoUpdater.checkForUpdates()
    }, 1 * 60 * 60 * 1000)
    autoUpdater.checkForUpdates()
  }

  try {
    const [, localSettings] = await Promise.all([devExtensionsPromise, localSettingsPromise])

    setupIpc(localSettings)
    await createWindow(localSettings, currentSession())
  } catch (err) {
    logger.error('Error initializing: ' + err)
    console.error(err)
    dialog.showErrorBox(
      'ShieldBattery Error', 'There was an error initializing ShieldBattery: ' + err.message)
    app.quit()
  }
})
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (!mainWindow) {
    createWindow()
  }
})
