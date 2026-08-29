import { app, BrowserWindow, Menu, shell, Tray } from 'electron'
import path from 'path'
import { APP_ROOT } from './app-paths'
import logger from './logger'
import { getUserDataPath } from './user-data-path'

const NORMAL_ICON = path.join(APP_ROOT, 'assets', 'shieldbattery-tray.png')
const UNREAD_ICON = path.join(APP_ROOT, 'assets', 'shieldbattery-tray-unread.png')
const URGENT_ICON = path.join(APP_ROOT, 'assets', 'shieldbattery-tray-urgent.png')
const BALLOON_ICON = path.join(APP_ROOT, 'assets', 'shieldbattery-64.png')

export default class SystemTray {
  /**
   * Whether any conversation with tracked read state has unread messages, as reported by the
   * renderer. Cleared only by the messages actually being read (possibly from another of the
   * user's sessions), never by window focus.
   */
  private hasTrackedUnread = false
  /**
   * Attention state for messages with no tracked read state (lobby/matchmaking chat) and urgent
   * messages, accumulated while the window is unfocused and cleared when it gains focus.
   */
  private hasTransientUnread = false
  private hasTransientUrgent = false
  private shownIcon = NORMAL_ICON
  private systemTray: Tray

  constructor(
    readonly mainWindow: BrowserWindow | null,
    readonly onQuitClick: () => void,
  ) {
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

  setTrackedUnread = (hasUnread: boolean) => {
    this.hasTrackedUnread = hasUnread
    this.updateIcon()
  }

  showTransientUnreadIcon = (urgent = false) => {
    this.hasTransientUnread = true
    this.hasTransientUrgent ||= urgent
    this.updateIcon()
  }

  clearTransientUnreadIcon = () => {
    this.hasTransientUnread = false
    this.hasTransientUrgent = false
    this.updateIcon()
  }

  private updateIcon() {
    let icon = NORMAL_ICON
    if (this.hasTransientUrgent) {
      icon = URGENT_ICON
    } else if (this.hasTrackedUnread || this.hasTransientUnread) {
      icon = UNREAD_ICON
    }

    if (icon !== this.shownIcon) {
      this.shownIcon = icon
      this.systemTray.setImage(icon)
    }
  }
}
