import { useEffect } from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import { useAppSelector } from '../redux-hooks'

const ipcRenderer = new TypedIpcRenderer()

function UnreadTraySyncImpl() {
  const hasUnread = useAppSelector(
    s => s.chat.unreadChannels.size > 0 || s.whispers.byId.values().some(w => w.hasUnread),
  )

  useEffect(() => {
    ipcRenderer.send('chatUnreadState', { hasUnread })
  }, [hasUnread])

  return null
}

/**
 * Mirrors whether any chat channel or whisper conversation has unread messages to the main
 * process, which reflects it on the system tray icon. Reports the current value on mount (the main
 * process's view goes stale across renderer reloads) and on every change after that.
 */
export const UnreadTraySync = IS_ELECTRON ? UnreadTraySyncImpl : () => null
