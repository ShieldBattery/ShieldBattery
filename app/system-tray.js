import { app, Menu, shell, Tray } from 'electron'
import path from 'path'
import { getUserDataPath } from './user-data-path'

const NORMAL_ICON = path.join(__dirname, 'assets', 'shieldbattery-16.png')
const UNREAD_ICON = path.join(__dirname, 'assets', 'shieldbattery-16-notification.png')
const BALLOON_ICON = path.join(__dirname, 'assets', 'shieldbattery-64.png')

export default class SystemTray {
  constructor(mainWindow, quitAppFn) {
    this.mainWindow = mainWindow
    this.onQuitClick = quitAppFn

    this.systemTray = new Tray(NORMAL_ICON)
    this.systemTray.setToolTip(app.name)
    this.systemTray.setContextMenu(this.buildContextMenu())
    this.systemTray.on('click', this.onTrayClick)
  }

  buildContextMenu = () => {
    return Menu.buildFromTemplate([
      { label: 'Restore', type: 'normal', click: this.onTrayClick },
      { label: 'Open Logs Folder', type: 'normal', click: this.onOpenLogs },
      { label: `Quit ${app.name}`, type: 'normal', click: this.onQuitClick },
    ])
  }

  onOpenLogs = () => {
    shell.openPath(path.join(getUserDataPath(), 'logs'))
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

  setUnreadIcon = (isHighlighted = false) => {
    // TODO(2Pac): Use a different icon for highlighted messages, once we make one
    this.systemTray.setImage(isHighlighted ? UNREAD_ICON : UNREAD_ICON)
  }

  clearUnreadIcon = () => {
    this.systemTray.setImage(NORMAL_ICON)
  }
}
