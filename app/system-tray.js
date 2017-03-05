import { app, Menu, Tray } from 'electron'

export default class SystemTray {
  constructor(mainWindow) {
    this.mainWindow = mainWindow

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

  onQuitClick = () => {
    return this.mainWindow ? this.mainWindow.close() : null
  }

  onTrayClick = () => {
    if (this.mainWindow == null) {
      return
    }

    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.focus()
    } else {
      this.mainWindow.show()
    }
  }

  displayHowToCloseHint = () => {
    const message =
        'ShieldBattery is running in the background. You can right-click on the icon below to quit.'
    this.systemTray.displayBalloon({
      title: 'Shieldbattery',
      content: message,
    })
  }
}
