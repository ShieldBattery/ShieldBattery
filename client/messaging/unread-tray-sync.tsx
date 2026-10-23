import { useEffect } from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import { anyChannelHasUnreadMention, anyChannelNeedsAttention } from '../chat/chat-reducer'
import { useAppSelector } from '../redux-hooks'
import { hasAttentionWorthyWhisper } from '../whispers/whisper-reducer'

const ipcRenderer = new TypedIpcRenderer()

function UnreadTraySyncImpl() {
  const hasUnread = useAppSelector(
    s =>
      anyChannelNeedsAttention(s.chat) ||
      hasAttentionWorthyWhisper(s.whispers, s.relationships.blocks),
  )
  // A whisper is inherently directed at the current user, so any unread whisper counts as urgent
  // alongside a channel message that mentions them.
  const hasUnreadUrgent = useAppSelector(
    s =>
      anyChannelHasUnreadMention(s.chat) ||
      hasAttentionWorthyWhisper(s.whispers, s.relationships.blocks),
  )

  useEffect(() => {
    ipcRenderer.send('chatUnreadState', { hasUnread, hasUnreadUrgent })
  }, [hasUnread, hasUnreadUrgent])

  return null
}

/**
 * Mirrors whether any chat channel or whisper conversation has unread messages to the main
 * process, which reflects it on the system tray icon. Reports the current value on mount (the main
 * process's view goes stale across renderer reloads) and on every change after that.
 */
export const UnreadTraySync = IS_ELECTRON ? UnreadTraySyncImpl : () => null
