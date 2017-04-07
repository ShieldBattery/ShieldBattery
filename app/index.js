process.env.BABEL_ENV = 'app'

require('babel-register')
require('babel-polyfill')

const isDev = require('electron-is-dev')
const app = require('electron').app

let getMainWindow


// Ensure that it's only possible to open a single instance of the application in non-dev mode. If
// someone tries to open two instances, we just focus the main window
if (!isDev) {
  const shouldQuit = app.makeSingleInstance(() => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show()
        return true
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }

    return true
  })

  if (shouldQuit) {
    app.quit()
  } else {
    getMainWindow = require('./app.js').getMainWindow
  }
} else {
  require('./app.js')
}
