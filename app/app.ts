import crypto from 'crypto'
import { app, BrowserWindow, dialog, Menu, protocol, screen, Session, shell } from 'electron'
import isDev from 'electron-is-dev'
import localShortcut from 'electron-localshortcut'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import fsPromises from 'fs/promises'
import ReplayParser, { ReplayHeader } from 'jssuh'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { container } from 'tsyringe'
import { URL } from 'url'
import swallowNonBuiltins from '../common/async/swallow-non-builtins'
import { FsDirent, TypedIpcMain, TypedIpcSender } from '../common/ipc'
import { ReplayShieldBatteryData } from '../common/replays'
import { checkShieldBatteryFiles } from './check-shieldbattery-files'
import currentSession from './current-session'
import { ActiveGameManager } from './game/active-game-manager'
import { checkStarcraftPath } from './game/check-starcraft-path'
import createGameServer, { GameServer } from './game/game-server'
import { MapStore } from './game/map-store'
import logger from './logger'
import { parseShieldbatteryReplayData } from './parse-shieldbattery-replay'
import { RallyPointManager } from './rally-point/rally-point-manager'
import './security/client'
import { collect } from './security/client'
import { LocalSettings, ScrSettings } from './settings'
import SystemTray from './system-tray'
import { getUserDataPath } from './user-data-path'

// Allow accessing __WEBPACK_ENV in development, since webpack adds it in production
if (!(global as any).__WEBPACK_ENV) {
  ;(global as any).__WEBPACK_ENV = {}
}

process
  .on('uncaughtException', function (err) {
    // NOTE(tec27): Electron seems to emit null errors sometimes? Not much we can do about logging
    // them. (One I have definitely seen this for is 'ResizeObserver loop limit exceeded', which
    // is an error that can be safely ignored anyway)
    if (!err) return

    console.error(err.stack ?? err)
    logger.error(err.stack ?? String(err))
    // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
    // dialog to user?
  })
  .on('unhandledRejection', function (err) {
    logger.error((err as any).stack ?? String(err))
    if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
      // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
      // dialog to user?
    }
    // Other promise rejections are likely less severe, leave the process up but log it
  })

const ipcMain = new TypedIpcMain()

getUserDataPath()

let modelId: string
// We override the default auto-updater URL so that we can use our Spaces CDN instead, should be
// faster for people not in US East
let updateUrl: string
switch ((app.name.split('-')[1] ?? '').toLowerCase()) {
  case 'local':
    modelId = 'net.shieldbattery.client.local'
    // We don't auto-update on this client so this doesn't really matter
    updateUrl = 'https://example.org/'
    break
  case 'staging':
    modelId = 'net.shieldbattery.client.staging'
    updateUrl = 'https://staging-cdn.shieldbattery.net/app/'
    break
  default:
    modelId = 'net.shieldbattery.client'
    updateUrl = 'https://cdn.shieldbattery.net/app/'
    break
}
app.setAppUserModelId(modelId)

autoUpdater.logger = logger
// We control the download ourselves to avoid problems with double-downloading that this library
// sometimes has
autoUpdater.autoDownload = false
let downloadingUpdate = false

logger.info('Setting auto-updater url to: ' + updateUrl)
autoUpdater.setFeedURL({
  provider: 'generic',
  url: updateUrl,
  // NOTE(tec27): This is false for S3 because it doesn't support it, but I think Spaces will?
  useMultipleRangeRequest: true,
})

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

// Keep a reference to the window and system tray objects so they don't get GC'd and closed
let mainWindow: BrowserWindow | null
let systemTray: SystemTray
let gameServer: GameServer

export const getMainWindow = () => mainWindow

let cachedIds: [number, string][] = []
let cachedIdPath: string | undefined

async function cacheIdsIfNeeded(newPath?: string, force?: boolean) {
  if (force || newPath !== cachedIdPath) {
    cachedIds = await collect(msg => logger.error(msg), modelId, newPath)
    cachedIdPath = newPath
  }
}

async function createLocalSettings() {
  const sbSessionName = process.env.SB_SESSION
  const fileName = sbSessionName ? `settings-${sbSessionName}.json` : 'settings.json'
  const settings = new LocalSettings(path.join(getUserDataPath(), fileName))
  await settings.untilInitialized()
  await cacheIdsIfNeeded((await settings.get()).starcraftPath, true /* force */)
  return settings
}

async function createScrSettings() {
  const sbSessionName = process.env.SB_SESSION
  const fileName = sbSessionName ? `scr-settings-${sbSessionName}.json` : 'scr-settings.json'
  const settings = new ScrSettings(
    path.join(getUserDataPath(), fileName),
    path.join(app.getPath('documents'), 'StarCraft', 'CSettings.json'),
    path.join(
      getUserDataPath(),
      sbSessionName ? `CSettings-${sbSessionName}.json` : 'CSettings.json',
    ),
  )
  await settings.untilInitialized()
  return settings
}

function setupIpc(localSettings: LocalSettings, scrSettings: ScrSettings) {
  ipcMain.handle('logMessage', (event, level, message) => {
    logger.log(level, message)
  })

  ipcMain.handle('settingsOverwriteBlizzardFile', async () => {
    await scrSettings.writeGameSettingsFile()
  })

  ipcMain
    .on('settingsLocalGet', event => {
      localSettings.get().then(
        settings => TypedIpcSender.from(event.sender).send('settingsLocalChanged', settings),
        err => {
          logger.error('Error getting local settings: ' + err)
          TypedIpcSender.from(event.sender).send('settingsLocalGetError', err)
        },
      )
    })
    .on('settingsScrGet', event => {
      scrSettings.get().then(
        settings => TypedIpcSender.from(event.sender).send('settingsScrChanged', settings),
        err => {
          logger.error('Error getting SC:R settings: ' + err)
          TypedIpcSender.from(event.sender).send('settingsScrGetError', err)
        },
      )
    })
    .on('settingsLocalMerge', (event, settings) => {
      // This will trigger a change if things changed, which will then emit a LOCAL_SETTINGS_CHANGED
      localSettings.merge(settings).catch(err => {
        logger.error('Error merging local settings: ' + err)
        TypedIpcSender.from(event.sender).send('settingsLocalMergeError', err)
      })
    })
    .on('settingsScrMerge', (event, settings) => {
      // This will trigger a change if things changed, which will then emit a SCR_SETTINGS_CHANGED
      scrSettings.merge(settings).catch(err => {
        logger.error('Error merging SC:R settings: ' + err)
        TypedIpcSender.from(event.sender).send('settingsScrMergeError', err)
      })
    })

  ipcMain
    .on('windowClose', (_, shouldDisplayCloseHint) => {
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
    .on('windowMaximize', () => {
      if (!mainWindow) {
        return
      }
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    })
    .on('windowMinimize', () => {
      if (!mainWindow) {
        return
      }
      mainWindow.minimize()
    })

  let lastRunAppAtSystemStart: boolean | undefined
  let lastRunAppAtSystemStartMinimized: boolean | undefined

  localSettings.on('change', settings => {
    if (
      lastRunAppAtSystemStart !== settings.runAppAtSystemStart ||
      lastRunAppAtSystemStartMinimized !== settings.runAppAtSystemStartMinimized
    ) {
      app.setLoginItemSettings({
        openAtLogin: settings.runAppAtSystemStart,
        args: [settings.runAppAtSystemStartMinimized ? '--hidden' : ''],
      })
      lastRunAppAtSystemStart = settings.runAppAtSystemStart
      lastRunAppAtSystemStartMinimized = settings.runAppAtSystemStartMinimized
    }

    TypedIpcSender.from(mainWindow?.webContents).send('settingsLocalChanged', settings)
  })
  scrSettings.on('change', settings => {
    TypedIpcSender.from(mainWindow?.webContents).send('settingsScrChanged', settings)
  })

  let updateState:
    | 'updaterUpToDate'
    | 'updaterNewVersionFound'
    | 'updaterNewVersionDownloaded'
    | 'updaterDownloadError' = 'updaterUpToDate'
  const sendUpdateState = () => {
    if (mainWindow) {
      mainWindow.webContents.send(updateState)
    }
  }
  autoUpdater
    .on('update-available', () => {
      updateState = 'updaterNewVersionFound'
      if (!downloadingUpdate) {
        downloadingUpdate = true
        autoUpdater.downloadUpdate()
      }
      sendUpdateState()
    })
    .on('update-not-available', () => {
      updateState = 'updaterUpToDate'
      sendUpdateState()
    })
    .on('update-downloaded', () => {
      updateState = 'updaterNewVersionDownloaded'
      downloadingUpdate = false
      sendUpdateState()
    })
    .on(
      'download-progress',
      (progressInfo: {
        total: number
        delta: number
        transferred: number
        percent: number
        bytesPerSecond: number
      }) => {
        mainWindow?.webContents.send('updaterDownloadProgress', {
          bytesTransferred: progressInfo.transferred,
          totalBytes: progressInfo.total,
          bytesPerSecond: progressInfo.bytesPerSecond,
        })
      },
    )
    .on('error', () => {
      if (updateState === 'updaterNewVersionFound') {
        updateState = 'updaterDownloadError'
        downloadingUpdate = false
        sendUpdateState()
      }
    })

  ipcMain
    .on('updaterQuitAndInstall', () => {
      autoUpdater.quitAndInstall()
    })
    .on('updaterGetState', event => {
      TypedIpcSender.from(event.sender).send(updateState)
    })

  if (!isDev) {
    ipcMain.on('networkSiteConnected', () => {
      autoUpdater.checkForUpdates()
    })
  }

  ipcMain.on('chatNewMessage', (event, data) => {
    if (mainWindow && !mainWindow.isFocused()) {
      if (systemTray) {
        systemTray.showUnreadIcon(data.urgent)
      }

      if (data.urgent) {
        mainWindow.flashFrame(true)
      }
    }
  })

  ipcMain.on('userAttentionRequired', event => {
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true)
    }
  })

  ipcMain.handle('pathsGetDocumentsPath', async event => {
    return app.getPath('documents')
  })

  ipcMain.handle('securityGetClientIds', async event => {
    await cacheIdsIfNeeded((await localSettings.get()).starcraftPath)
    return cachedIds
  })

  ipcMain.handle('settingsCheckStarcraftPath', async (event, path) => {
    cacheIdsIfNeeded(path).catch(swallowNonBuiltins)
    return checkStarcraftPath(path)
  })

  ipcMain.handle('settingsBrowseForStarcraft', async (event, defaultPath) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select StarCraft folder',
      defaultPath,
      properties: ['openDirectory'],
    })

    return { canceled, filePaths }
  })

  ipcMain.handle('settingsGetPrimaryResolution', async event => {
    const primaryDisplay = screen.getPrimaryDisplay()
    return primaryDisplay.size
  })

  const activeGameManager = container.resolve(ActiveGameManager)

  activeGameManager
    .on('gameStatus', status => {
      TypedIpcSender.from(mainWindow?.webContents).send('activeGameStatus', status)
    })
    .on('resendResults', (gameId, requestBody) => {
      TypedIpcSender.from(mainWindow?.webContents).send(
        'activeGameResendResults',
        gameId,
        requestBody,
      )
    })

  ipcMain.handle('activeGameStartWhenReady', (event, gameId) =>
    activeGameManager.startWhenReady(gameId),
  )
  ipcMain.handle('activeGameSetConfig', (event, config) => {
    try {
      return activeGameManager.setGameConfig(config)
    } catch (err: any) {
      logger.error(`Error setting game config: ${err?.stack ?? err}`)
      return null
    }
  })
  ipcMain.handle('activeGameSetRoutes', (event, gameId, routes) =>
    activeGameManager.setGameRoutes(gameId, routes),
  )

  ipcMain.handle('fsReadFile', async (_, filePath) => {
    return fsPromises.readFile(filePath)
  })
  ipcMain.handle('fsReadDir', async (_, dirPath, options) => {
    const result = await fsPromises.readdir(dirPath, options)
    return result.map<FsDirent>(d => ({
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
      name: d.name,
    }))
  })
  ipcMain.handle('fsStat', async (_, filePath) => {
    const result = await fsPromises.stat(filePath)
    return {
      isFile: result.isFile(),
      isDirectory: result.isDirectory(),
      size: result.size,
      blksize: result.blksize,
      blocks: result.blocks,
      atimeMs: result.atimeMs,
      mtimeMs: result.mtimeMs,
      ctimeMs: result.ctimeMs,
      birthtimeMs: result.birthtimeMs,
      atime: result.atime,
      mtime: result.mtime,
      ctime: result.ctime,
      birthtime: result.birthtime,
    }
  })

  const mapStore = container.resolve(MapStore)

  ipcMain.handle('mapStoreDownloadMap', (event, mapHash, mapFormat, mapUrl) =>
    mapStore.downloadMap(mapHash, mapFormat, mapUrl),
  )

  ipcMain.handle('replayParseMetadata', async (event, replayPath) => {
    return new Promise(async (resolve, reject) => {
      const parser = new ReplayParser()
      let headerData: ReplayHeader
      parser.on('replayHeader', header => {
        headerData = header
      })

      let shieldBatteryData: ReplayShieldBatteryData
      parser.rawScrSection('Sbat', buffer => {
        try {
          shieldBatteryData = parseShieldbatteryReplayData(buffer)
        } catch (err) {
          reject(err)
        }
      })

      parser.on('end', () => {
        resolve({ headerData, shieldBatteryData })
      })

      const promise = pipeline(fs.createReadStream(replayPath), parser)

      parser.resume()
      await promise
    })
  })

  ipcMain.handle('shieldbatteryCheckFiles', () => checkShieldBatteryFiles())

  const rallyPointManager = container.resolve(RallyPointManager)

  ipcMain.on('rallyPointSetServers', (event, servers) => {
    rallyPointManager.setServers(servers)
  })
  ipcMain.on('rallyPointUpsertServer', (event, server) => {
    rallyPointManager.upsertServer(server)
  })
  ipcMain.on('rallyPointDeleteServer', (event, id) => {
    rallyPointManager.deleteServer(id)
  })
  ipcMain.on('rallyPointRefreshPings', () => {
    rallyPointManager.refreshPings()
  })
  rallyPointManager.on('ping', (server, ping) => {
    TypedIpcSender.from(mainWindow?.webContents).send('rallyPointPingResult', server, ping)
  })
}

function setupCspProtocol(curSession: Session) {
  // Register a protocol that will perform two functions:
  // - Return our index.html file and scripts/styles with the proper style/script values filled out
  // - Add fake headers to the response such that we set up CSP with a nonce (necessary for
  //   styled-components to work properly), and unfortunately not really possible to do without
  //   HTTP headers
  curSession.protocol.registerStreamProtocol('shieldbattery', (req, cb) => {
    const url = new URL(req.url)

    const pathname = path.posix.normalize(url.pathname)

    if (pathname === '/index.js' || pathname.match(/^\/(assets|dist|native)\/.+$/)) {
      cb(fs.createReadStream(path.join(__dirname, pathname)))
    } else {
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
        const analyticsId = process.env.SB_ANALYTICS_ID ?? __WEBPACK_ENV?.SB_ANALYTICS_ID ?? ''
        const result = data
          .replace(
            /%SCRIPT_URL%/g,
            isHot ? 'http://localhost:5566/dist/bundle.js' : '/dist/bundle.js',
          )
          .replace(/%CSP_NONCE%/g, nonce)
          .replace(/%ANALYTICS_ID%/g, analyticsId)
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
              "font-src 'self' https://fonts.gstatic.com;" +
              "object-src 'none';" +
              "form-action 'none';",
          },
          data: dataStream,
        })
      })
    }
  })
}

function setupAnalytics(curSession: Session) {
  // The analytics script will 403 unless it's requested with a referer (and since we're on a weird
  // scheme, Chromium acts as if we're insecure and refuses to send the origin). So, we add in the
  // referrer manually on this request.
  const filter = {
    urls: ['https://obs.shieldbattery.net/*'],
  }
  curSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    details.requestHeaders.referer = 'shieldbattery://app'
    cb({ requestHeaders: details.requestHeaders })
  })
}

function registerHotkeys() {
  const isMac = process.platform === 'darwin'
  localShortcut.register(mainWindow!, isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', () =>
    mainWindow?.webContents.toggleDevTools(),
  )
  localShortcut.register(mainWindow!, 'F12', () => mainWindow?.webContents.toggleDevTools())

  localShortcut.register(mainWindow!, 'CmdOrCtrl+R', () => {
    // TODO(tec27): Also allow for this if the user has the debug privilege
    if (isDev) {
      mainWindow?.webContents.reloadIgnoringCache()
    }
  })
  localShortcut.register(mainWindow!, 'CmdOrCtrl+Shift+R', () => {
    // TODO(tec27): Also allow for this if the user has the debug privilege
    if (isDev) {
      mainWindow?.webContents.reloadIgnoringCache()
    }
  })
  localShortcut.register(mainWindow!, 'F5', () => {
    // TODO(tec27): Also allow for this if the user has the debug privilege
    if (isDev) {
      mainWindow?.webContents.reloadIgnoringCache()
    }
  })

  localShortcut.register(mainWindow!, 'F11', () => {
    mainWindow?.setFullScreen(!mainWindow?.isFullScreen())
  })
}

async function createWindow() {
  const localSettings = container.resolve(LocalSettings)
  const curSession = currentSession()

  // TODO(tec27): verify that window positioning is still valid on current monitor setup
  const { winX, winY, winWidth, winHeight, winMaximized } = await localSettings.get()

  mainWindow = new BrowserWindow({
    width: winWidth && winWidth > 0 ? winWidth : 1024,
    height: winHeight && winHeight > 0 ? winHeight : 800,
    x: winX && winX !== -1 ? winX : undefined,
    y: winY && winY !== -1 ? winY : undefined,
    minWidth: 1024,
    minHeight: 600,

    acceptFirstMouse: true,
    backgroundColor: '#0E1B2A',
    frame: false,
    transparent: false,
    show: false,
    title: 'ShieldBattery',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.js'),
      session: curSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  if (winMaximized) {
    mainWindow.maximize()
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
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
      TypedIpcSender.from(mainWindow?.webContents).send('windowMaximizedState', true)
    })
    .on('unmaximize', () => {
      localSettings.merge({ winMaximized: false }).catch(err => {
        logger.error('Error saving new window maximized state: ' + err)
      })
      TypedIpcSender.from(mainWindow?.webContents).send('windowMaximizedState', false)
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
      mainWindow?.flashFrame(false)
      TypedIpcSender.from(mainWindow?.webContents).send('windowFocusChanged', true)
    })
    .on('blur', () => {
      TypedIpcSender.from(mainWindow?.webContents).send('windowFocusChanged', false)
    })
    .on('show', () => {
      if (systemTray) {
        systemTray.clearUnreadIcon()
      }
    })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== 'shieldbattery://app' && !url.startsWith('shieldbattery://app/')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url)
      const protocol = parsedUrl.protocol.toLowerCase()

      // Whitelist safe protocols to prevent someone from e.g. linking to a local file and causing
      // users to launch it
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch (err) {
      logger.error('Error while parsing window.open URL: ' + err)
    }

    return { action: 'deny' }
  })

  registerHotkeys()

  if (!process.argv.includes('--hidden')) {
    mainWindow.once('ready-to-show', () => {
      mainWindow!.show()
      if (!isDev) {
        ipcMain.on('networkSiteConnected', () => {
          autoUpdater.checkForUpdates()
        })
      }
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL('shieldbattery://app')
}

app.on('ready', async () => {
  const localSettingsPromise = createLocalSettings()
  const scrSettingsPromise = createScrSettings()

  // We don't display this anyway, and it registers shortcuts for things that we don't want (e.g.
  // Ctrl+W to close, Ctrl+R to refresh [which we don't want outside of dev])
  Menu.setApplicationMenu(null)

  if (!isDev) {
    autoUpdater.checkForUpdates()
  }

  try {
    const [localSettings, scrSettings] = await Promise.all([
      localSettingsPromise,
      scrSettingsPromise,
    ])

    container.register(LocalSettings, { useValue: localSettings })
    container.register(ScrSettings, { useValue: scrSettings })

    const mapDirPath = path.join(app.getPath('userData'), 'maps')
    const mapStore = new MapStore(mapDirPath)
    container.register(MapStore, { useValue: mapStore })

    setupIpc(localSettings, scrSettings)
    setupCspProtocol(currentSession())
    setupAnalytics(currentSession())
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    gameServer = createGameServer(localSettings)
    await createWindow()
    systemTray = new SystemTray(mainWindow, () => app.quit())

    mainWindow?.webContents.on('did-finish-load', () => {
      TypedIpcSender.from(mainWindow?.webContents).send(
        'windowMaximizedState',
        mainWindow?.isMaximized() ?? false,
      )
      TypedIpcSender.from(mainWindow?.webContents).send(
        'windowFocusChanged',
        mainWindow?.isFocused() ?? false,
      )
    })
  } catch (err: any) {
    logger.error('Error initializing: ' + err)
    console.error(err)
    dialog.showErrorBox(
      'ShieldBattery Error',
      `There was an error initializing ShieldBattery: ${err.message}\n${err.stack}`,
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
