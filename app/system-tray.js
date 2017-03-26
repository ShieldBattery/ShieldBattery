import { app, Menu, Tray } from 'electron'

export default class SystemTray {
  constructor(mainWindow, quitAppFn) {
    this.mainWindow = mainWindow
    this.onQuitClick = quitAppFn

    this.systemTray = new Tray('icon.ico')
    this.systemTray.setToolTip('ShieldBattery')
    this.systemTray.setContextMenu(this.buildContextMenu())
    this.systemTray.on('click', this.onTrayClick)
  }

  buildContextMenu = () => {
    return Menu.buildFromTemplate([
      { label: `Quit ${app.getName()}`, type: 'normal', click: this.onQuitClick },
    ])
  }

  onTrayClick = () => {
    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.focus()
    } else {
      this.mainWindow.show()
    }
  }

  displayHowToCloseHint = () => {
    const message =
        'ShieldBattery is running in the background. Right click the system tray icon to quit.'
    this.systemTray.displayBalloon({
      title: 'Shieldbattery',
      content: message,
    })
  }
}
