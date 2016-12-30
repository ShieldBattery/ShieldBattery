import { app, BrowserWindow, session } from 'electron'
import path from 'path'
import url from 'url'

function applyOriginFilter() {
  // Modify the origin for all ShieldBattery server requests
  const filter = {
    urls: ['https://*.shieldbattery.net/*', 'http://localhost:*/*']
  }
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders.Origin = 'http://client.shieldbattery.net'
    callback({ cancel: false, requestHeaders: details.requestHeaders })
  })
}

// Keep a reference to the window object so that it doesn't get GC'd and closed
let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({ width: 800, height: 600 })
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true
  }))
  mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

app.on('ready', () => {
  applyOriginFilter()
  createWindow()
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
  if (mainWindow === null) {
    createWindow()
  }
})
