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

import { LocalSettings, ScrSettings } from './settings'
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
  LOCAL_SETTINGS_CHANGED,
  LOCAL_SETTINGS_GET,
  LOCAL_SETTINGS_GET_ERROR,
  LOCAL_SETTINGS_MERGE,
  LOCAL_SETTINGS_MERGE_ERROR,
  SCR_SETTINGS_CHANGED,
  SCR_SETTINGS_GET,
  SCR_SETTINGS_GET_ERROR,
  SCR_SETTINGS_MERGE,
  SCR_SETTINGS_MERGE_ERROR,
  SCR_SETTINGS_OVERWRITE,
  USER_ATTENTION_REQUIRED,
  WINDOW_CLOSE,
  WINDOW_MAXIMIZE,
  WINDOW_MAXIMIZED_STATE,
  WINDOW_MINIMIZE,
} from '../common/ipc-constants'

autoUpdater.logger = logger
// We control the download ourselves to avoid problems with double-downloading that this library
// sometimes has
autoUpdater.autoDownload = false
let downloadingUpdate = false

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

async function createLocalSettings() {
  const sbSessionName = process.env.SB_SESSION
  const fileName = sbSessionName ? `settings-${sbSessionName}.json` : 'settings.json'
  const settings = new LocalSettings(path.join(getUserDataPath(), fileName))
  await settings.untilInitialized()
  return settings
}

async function createScrSettings() {
  const sbSessionName = process.env.SB_SESSION
  const fileName = sbSessionName ? `scr-settings-${sbSessionName}.json` : 'scr-settings.json'
  const settings = new ScrSettings(
    path.join(getUserDataPath(), fileName),
    path.join(app.getPath('documents'), 'StarCraft', 'CSettings.json'),
  )
  await settings.untilInitialized()
  return settings
}

function setupIpc(localSettings, scrSettings) {
  ipcMain.on(LOG_MESSAGE, (event, level, message) => {
    logger.log(level, message)
  })

  ipcMain.handle(SCR_SETTINGS_OVERWRITE, async () => {
    await scrSettings.overwrite()
  })

  ipcMain
    .on(LOCAL_SETTINGS_GET, event => {
      localSettings.get().then(
        settings => event.sender.send(LOCAL_SETTINGS_CHANGED, settings),
        err => {
          logger.error('Error getting local settings: ' + err)
          event.sender.send(LOCAL_SETTINGS_GET_ERROR, err)
        },
      )
    })
    .on(SCR_SETTINGS_GET, event => {
      scrSettings.get().then(
        settings => event.sender.send(SCR_SETTINGS_CHANGED, settings),
        err => {
          logger.error('Error getting SC:R settings: ' + err)
          event.sender.send(SCR_SETTINGS_GET_ERROR, err)
        },
      )
    })
    .on(LOCAL_SETTINGS_MERGE, (event, settings) => {
      // This will trigger a change if things changed, which will then emit a LOCAL_SETTINGS_CHANGED
      localSettings.merge(settings).catch(err => {
        logger.error('Error merging local settings: ' + err)
        event.sender.send(LOCAL_SETTINGS_MERGE_ERROR, err)
      })
    })
    .on(SCR_SETTINGS_MERGE, (event, settings) => {
      // This will trigger a change if things changed, which will then emit a SCR_SETTINGS_CHANGED
      scrSettings.merge(settings).catch(err => {
        logger.error('Error merging SC:R settings: ' + err)
        event.sender.send(SCR_SETTINGS_MERGE_ERROR, err)
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
      mainWindow.webContents.send(LOCAL_SETTINGS_CHANGED, settings)
    }
  })
  scrSettings.on(ScrSettings.EVENT, settings => {
    if (mainWindow) {
      mainWindow.webContents.send(SCR_SETTINGS_CHANGED, settings)
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
      if (!downloadingUpdate) {
        downloadingUpdate = true
        autoUpdater.downloadUpdate()
      }
      sendUpdateState()
    })
    .on('update-not-available', () => {
      updateState = NEW_VERSION_UP_TO_DATE
      sendUpdateState()
    })
    .on('update-downloaded', () => {
      updateState = NEW_VERSION_DOWNLOADED
      downloadingUpdate = false
      sendUpdateState()
    })
    .on('error', () => {
      if (updateState === NEW_VERSION_FOUND) {
        updateState = NEW_VERSION_DOWNLOAD_ERROR
        downloadingUpdate = false
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

  ipcMain.on(USER_ATTENTION_REQUIRED, (event, data) => {
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.once('focus', () => mainWindow.flashFrame(false))
      mainWindow.flashFrame(true)
    }
  })
}

function setupCspProtocol(curSession) {
  // Register a protocol that will perform two functions:
  // - Return our index.html file and scripts/styles with the proper style/script values filled out
  // - Add fake headers to the response such that we set up CSP with a nonce (necessary for
  //   styled-components to work properly), and unfortunately not really possible to do without
  //   HTTP headers
  curSession.protocol.registerStreamProtocol('shieldbattery', (req, cb) => {
    const url = new URL(req.url)

    const pathname = path.posix.normalize(url.pathname)

    if (pathname === '/') {
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
        const hasReactDevTools = !!process.env.SB_REACT_DEV
        const result = data
          .replace(
            /%SCRIPT_URL%/g,
            isHot ? 'http://localhost:5566/dist/bundle.js' : 'dist/bundle.js',
          )
          .replace(/%CSP_NONCE%/g, nonce)
          .replace(
            /%REACT_DEV%/g,
            hasReactDevTools ? '<script src="http://localhost:8097"></script>' : '',
          )

        const dataStream = new Readable()
        dataStream.push(result)
        dataStream.push(null)

        // Allow loading things from the remote React devtools if they're enabled
        const reactDevPolicy = hasReactDevTools ? 'http://localhost:8097' : ''
        // Allow loading extra chunks from the dev server in non-production
        const chunkPolicy = isHot ? 'http://localhost:5566' : ''
        // If hot-reloading is on, we have to allow eval so it can work
        const scriptEvalPolicy = isHot ? "'unsafe-eval'" : ''

        cb({
          statusCode: 200,
          headers: {
            'content-type': 'text/html',
            'content-security-policy':
              `script-src 'self' 'nonce-${nonce}' ${reactDevPolicy} ${chunkPolicy} ` +
              `${scriptEvalPolicy};` +
              `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com;` +
              "font-src 'self' https://fonts.gstatic.com;",
          },
          data: dataStream,
        })
      })
    } else {
      cb(fs.createReadStream(path.join(__dirname, pathname)))
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
    height: winHeight && winHeight > 0 ? winHeight : 800,
    x: winX && winX !== -1 ? winX : undefined,
    y: winY && winY !== -1 ? winY : undefined,

    acceptFirstMouse: true,
    backgroundColor: '#1B1E22',
    frame: false,
    show: false,
    title: 'ShieldBattery',
    webPreferences: {
      session: curSession,
      // TODO(tec27): Implement other ways to IPC than using the remote module, it's slow, and a
      // potential security risk
      enableRemoteModule: true,
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

  registerHotkeys()

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL('shieldbattery://app')
}

app.on('ready', async () => {
  const localSettingsPromise = createLocalSettings()
  const scrSettingsPromise = createScrSettings()

  if (!isDev) {
    autoUpdater.checkForUpdates()
  }

  try {
    const [localSettings, scrSettings] = await Promise.all([
      localSettingsPromise,
      scrSettingsPromise,
    ])

    setupIpc(localSettings, scrSettings)
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
