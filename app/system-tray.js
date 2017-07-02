import { app, Menu, Tray } from 'electron'
import path from 'path'

const NORMAL_ICON = path.join(__dirname, 'assets', 'shieldbattery-16.png')
const UNREAD_ICON = path.join(__dirname, 'assets', 'shieldbattery-16-notification.png')
const BALLOON_ICON = path.join(__dirname, 'assets', 'shieldbattery-64.png')

export default class SystemTray {
  constructor(mainWindow, quitAppFn) {
    this.mainWindow = mainWindow
    this.onQuitClick = quitAppFn

    this.systemTray = new Tray(NORMAL_ICON)
    this.systemTray.setToolTip(app.getName())
    this.systemTray.setContextMenu(this.buildContextMenu())
    this.systemTray.on('click', this.onTrayClick)
  }

  buildContextMenu = () => {
    return Menu.buildFromTemplate([
      { label: 'Restore', type: 'normal', click: this.onTrayClick },
      { label: `Quit ${app.getName()}`, type: 'normal', click: this.onQuitClick },
    ])
  }

  onTrayClick = () => {
    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.focus()
    } else {
      this.mainWindow.show()
    }
  }

  displayHowToCloseHint = () => {
    const message =
      'ShieldBattery is running in the background. Right click the system tray icon to quit.'
    this.systemTray.displayBalloon({
      icon: BALLOON_ICON,
      title: 'ShieldBattery',
      content: message,
    })
  }

  setUnreadIcon = () => {
    this.systemTray.setImage(UNREAD_ICON)
  }

  clearUnreadIcon = () => {
    this.systemTray.setImage(NORMAL_ICON)
  }
}
