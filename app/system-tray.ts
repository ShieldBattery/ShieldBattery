import { app, BrowserWindow, Menu, shell, Tray } from 'electron'
import * as path from 'node:path'
import logger from './logger.js'
import { getUserDataPath } from './user-data-path.js'

const NORMAL_ICON = path.join(import.meta.dirname, 'assets', 'shieldbattery-tray.png')
const UNREAD_ICON = path.join(import.meta.dirname, 'assets', 'shieldbattery-tray-unread.png')
const URGENT_ICON = path.join(import.meta.dirname, 'assets', 'shieldbattery-tray-urgent.png')
const BALLOON_ICON = path.join(import.meta.dirname, 'assets', 'shieldbattery-64.png')

export default class SystemTray {
  private isShowingUrgentIcon: boolean
  private systemTray: Tray

  constructor(
    readonly mainWindow: BrowserWindow | null,
    readonly onQuitClick: () => void,
  ) {
    this.isShowingUrgentIcon = false

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
    shell.openPath(path.join(getUserDataPath(), 'logs')).catch(err => {
      logger.error(`Failed to open logs folder: ${err.stack ?? err}`)
    })
  }

  onTrayClick = () => {
    if (this.mainWindow?.isVisible()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.focus()
    } else {
      this.mainWindow?.show()
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

  showUnreadIcon = (urgent = false) => {
    if (!this.isShowingUrgentIcon) {
      this.systemTray.setImage(urgent ? URGENT_ICON : UNREAD_ICON)
    }
    if (urgent) {
      this.isShowingUrgentIcon = true
    }
  }

  clearUnreadIcon = () => {
    this.isShowingUrgentIcon = false
    this.systemTray.setImage(NORMAL_ICON)
  }
}
