import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DiscordActivity } from '../../common/discord-presence'
import { TypedIpcRenderer } from '../../common/ipc'
import { useCurrentActivity } from '../activity/current-activity'
import { useAppSelector } from '../redux-hooks'
import { getDiscordActivity } from './discord-activity'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Keeps the user's Discord Rich Presence in line with what they're doing, sending the activity to
 * the main process whenever it changes. Renders nothing.
 */
export function DiscordActivitySync() {
  const { t } = useTranslation()
  const sharing = useAppSelector(s => s.settings.account.shareDiscordActivity)
  const currentActivity = useCurrentActivity()

  const activity: DiscordActivity | null = getDiscordActivity(currentActivity, sharing, t) ?? null
  // Compared as text, since every render builds a new object even when nothing in it changed.
  const serializedActivity = JSON.stringify(activity)

  useEffect(() => {
    ipcRenderer.send('discordSetActivity', JSON.parse(serializedActivity) as DiscordActivity | null)
  }, [serializedActivity])

  return null
}
