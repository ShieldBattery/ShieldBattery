import { getUserDataPath } from './user-data-path'
getUserDataPath()

import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import localShortcut from 'electron-localshortcut'
import path from 'path'
import isDev from 'electron-is-dev'
import logger from './logger'
import fs from 'fs'
import crypto from 'crypto'
import { Readable } from 'stream'
import { URL } from 'url'

app.setAppUserModelId('net.shieldbattery.client')

import LocalSettings from './local-settings'
import currentSession from './current-session'
import SystemTray from './system-tray'
import { autoUpdater } from 'electron-updater'
import {
  LOG_MESSAGE,
  NETWORK_SITE_CONNECTED,
  NEW_CHAT_MESSAGE,
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
  WINDOW_CLOSE,
  WINDOW_MAXIMIZE,
  WINDOW_MAXIMIZED_STATE,
  WINDOW_MINIMIZE,
} from './common/ipc-constants'

autoUpdater.logger = logger

// Set up our main file's protocol to enable the necessary features
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'shieldbattery',
    privileges: {
      // Ensure we have localStorage/cookies available
      standard: true,
      // Act like https
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

// TODO(tec27): Make process/native context-aware and then set this to true
app.allowRendererProcessorReuse = false

// Keep a reference to the window and system tray objects so they don't get GC'd and closed
let mainWindow
let systemTray

export const getMainWindow = () => mainWindow

async function installDevExtensions() {
  if (isDev) {
    const installer = require('electron-devtools-installer')
    const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS']
    // Apparently there's no way to upgrade extensions in Electron, so we're always forcing a
    // download.
    const forceDownload = true
    return Promise.all(extensions.map(name => installer.default(installer[name], forceDownload)))
  }

  return null
}

async function createLocalSettings() {
  const settings = new LocalSettings(path.join(getUserDataPath(), 'settings.json'))
  await settings.untilInitialized()
  return settings
}

function setupIpc(localSettings) {
  ipcMain.on(LOG_MESSAGE, (event, level, message) => {
    logger.log(level, message)
  })

  ipcMain
    .on(SETTINGS_EMIT, event => {
      localSettings.get().then(
        settings => event.sender.send(SETTINGS_CHANGED, settings),
        err => {
          logger.error('Error getting settings: ' + err)
          event.sender.send(SETTINGS_EMIT_ERROR, err)
        },
      )
    })
    .on(SETTINGS_MERGE, (event, settings) => {
      // This will trigger a change if things changed (which will then emit a SETTINGS_CHANGED)
      localSettings.merge(settings).catch(err => {
        logger.error('Error merging settings: ' + err)
        event.sender.send(SETTINGS_MERGE_ERROR, err)
      })
    })
    .on(WINDOW_CLOSE, (event, shouldDisplayCloseHint) => {
      if (!mainWindow) {
        return
      }
      if (systemTray) {
        mainWindow.hide()
        if (shouldDisplayCloseHint) systemTray.displayHowToCloseHint()
      } else {
        mainWindow.close()
      }
    })
    .on(WINDOW_MAXIMIZE, event => {
      if (!mainWindow) {
        return
      }
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    })
    .on(WINDOW_MINIMIZE, event => {
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
  autoUpdater
    .on('update-available', () => {
      updateState = NEW_VERSION_FOUND
      sendUpdateState()
    })
    .on('update-not-available', () => {
      updateState = NEW_VERSION_UP_TO_DATE
      sendUpdateState()
    })
    .on('update-downloaded', () => {
      updateState = NEW_VERSION_DOWNLOADED
      sendUpdateState()
    })
    .on('error', () => {
      if (updateState === NEW_VERSION_FOUND) {
        updateState = NEW_VERSION_DOWNLOAD_ERROR
        sendUpdateState()
      }
    })

  ipcMain
    .on(NEW_VERSION_RESTART, () => {
      autoUpdater.quitAndInstall()
    })
    .on(NEW_VERSION_GET_STATE, event => {
      event.sender.send(updateState)
    })

  if (!isDev) {
    ipcMain.on(NETWORK_SITE_CONNECTED, () => {
      autoUpdater.checkForUpdates()
    })
  }

  ipcMain.on(NEW_CHAT_MESSAGE, (event, data) => {
    if (mainWindow && !mainWindow.isFocused()) {
      if (systemTray) {
        systemTray.setUnreadIcon()
      }
    }
  })
}

function setupCspProtocol(curSession) {
  // Register a protocol that will perform two functions:
  // - Return our index.html file with the proper style/script values filled out
  // - Add fake headers to the response such that we set up CSP with a nonce (necessary for
  //   styled-components to work properly), and unfortunately not really possible to do without
  //   HTTP headers
  curSession.protocol.registerStreamProtocol('shieldbattery', (req, cb) => {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      fs.readFile(path.join(__dirname, 'index.html'), 'utf8', (err, data) => {
        if (err) {
          const dataStream = new Readable()
          dataStream.push('Error reading index.html')
          dataStream.push(null)
          cb({
            statusCode: 500,
            data: dataStream,
          })
          return
        }

        const nonce = crypto.randomBytes(16).toString('base64')
        const isHot = !!process.env.SB_HOT
        const result = data
          .replace(
            /%STYLESHEET_TAG%/g,
            isHot ? '' : `<link rel="stylesheet" href="styles/site.css" nonce="${nonce}" />`,
          )
          .replace(
            /%SCRIPT_URL%/g,
            isHot ? 'http://localhost:5566/dist/bundle.js' : 'dist/bundle.js',
          )
          .replace(/%CSP_NONCE%/g, nonce)

        const dataStream = new Readable()
        dataStream.push(result)
        dataStream.push(null)

        // If hot-reloading is on, we have to allow eval so it can work
        const scriptEvalPolicy = isHot ? "'unsafe-eval'" : ''

        cb({
          statusCode: 200,
          headers: {
            'content-type': 'text/html',
            'content-security-policy':
              `script-src 'self' 'nonce-${nonce}' ${scriptEvalPolicy};` +
              `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com;` +
              "font-src 'self' https://fonts.gstatic.com;",
          },
          data: dataStream,
        })
      })
    } else {
      cb(fs.createReadStream(path.join(__dirname, url.pathname)))
    }
  })
}

function registerHotkeys() {
  const isMac = process.platform === 'darwin'
  localShortcut.register(mainWindow, isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', () =>
    mainWindow.toggleDevTools(),
  )
  localShortcut.register(mainWindow, 'F12', () => mainWindow.toggleDevTools())

  localShortcut.register(mainWindow, 'CmdOrCtrl+R', () =>
    mainWindow.webContents.reloadIgnoringCache(),
  )
  localShortcut.register(mainWindow, 'F5', () => mainWindow.webContents.reloadIgnoringCache())
}

async function createWindow(localSettings, curSession) {
  // TODO(tec27): verify that window positioning is still valid on current monitor setup
  const { winX, winY, winWidth, winHeight, winMaximized } = await localSettings.get()
  mainWindow = new BrowserWindow({
    width: winWidth && winWidth > 0 ? winWidth : 1024,
    height: winHeight && winHeight > 0 ? winHeight : 768,
    x: winX && winX !== -1 ? winX : undefined,
    y: winY && winY !== -1 ? winY : undefined,
    // icon: path.join(__dirname, 'assets', 'shieldbattery-64.png'),

    acceptFirstMouse: true,
    backgroundColor: '#1B1E22',
    frame: false,
    show: false,
    title: 'ShieldBattery',
    webPreferences: {
      session: curSession,
      // TODO(tec27): Figure out a path to turning this off as it's a security risk
      nodeIntegration: true,
      // TODO(tec27): Ideally we'd turn these options on as well (note that these get turned on
      // automatically if the page has a CSP set, which is why we turn it off here)
      contextIsolation: false,
      sandbox: false,
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
    const { x: winX, y: winY, width: winWidth, height: winHeight } = mainWindow.getBounds()
    localSettings.merge({ winX, winY, winWidth, winHeight }).catch(err => {
      logger.error('Error saving new window bounds: ' + err)
    })
  }

  mainWindow
    .on('maximize', () => {
      localSettings.merge({ winMaximized: true }).catch(err => {
        logger.error('Error saving new window maximized state: ' + err)
      })
      mainWindow.webContents.send(WINDOW_MAXIMIZED_STATE, true)
    })
    .on('unmaximize', () => {
      localSettings.merge({ winMaximized: false }).catch(err => {
        logger.error('Error saving new window maximized state: ' + err)
      })
      mainWindow.webContents.send(WINDOW_MAXIMIZED_STATE, false)
    })
    .on('resize', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(handleResizeOrMove, 100)
    })
    .on('move', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(handleResizeOrMove, 100)
    })
    .on('focus', () => {
      if (systemTray) {
        systemTray.clearUnreadIcon()
      }
    })

  mainWindow.webContents
    .on('new-window', (event, url) => {
      event.preventDefault()
      shell.openExternal(url)
    })
    .on('will-navigate', event => {
      event.preventDefault()
    })

  mainWindow.loadURL('shieldbattery://app')

  registerHotkeys()

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', async () => {
  const devExtensionsPromise = installDevExtensions()
  const localSettingsPromise = createLocalSettings()

  if (!isDev) {
    autoUpdater.checkForUpdates()
  }

  try {
    const [, localSettings] = await Promise.all([devExtensionsPromise, localSettingsPromise])

    setupIpc(localSettings)
    setupCspProtocol(currentSession())
    await createWindow(localSettings, currentSession())
    systemTray = new SystemTray(mainWindow, () => app.quit())

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send(WINDOW_MAXIMIZED_STATE, mainWindow.isMaximized())
    })
  } catch (err) {
    logger.error('Error initializing: ' + err)
    console.error(err)
    dialog.showErrorBox(
      'ShieldBattery Error',
      'There was an error initializing ShieldBattery: ' + err.message,
    )
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
