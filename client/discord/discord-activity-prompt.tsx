import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { openDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import logger from '../logging/logger'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { mergeAccountSettings } from '../settings/action-creators'
import {
  accountSettingsSyncedUserAtom,
  gameDefaultsChoicePendingAtom,
} from '../settings/settings-atoms'
import { bodyMedium, bodySmall } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Asks a user who hasn't decided yet whether to show their activity on Discord, once per login,
 * and only when it can show: while the Discord desktop app runs, and with the Discord SDK loaded.
 * Otherwise the next login asks again. Waits for the account settings the server holds (a cached
 * or default "not asked" could be stale) and for the game defaults first-run dialog to be done.
 * Renders nothing.
 */
export function DiscordActivityFirstRunPrompt() {
  const dispatch = useAppDispatch()
  const userId = useSelfUser()?.id
  const sharing = useAppSelector(s => s.settings.account.shareDiscordActivity)
  const syncedUserId = useAtomValue(accountSettingsSyncedUserAtom)
  const gameDefaultsPending = useAtomValue(gameDefaultsChoicePendingAtom)
  const gameDefaultsOpen = useAppSelector(s =>
    s.dialog.history.some(dialog => dialog.type === DialogType.GameDefaultsFirstRun),
  )
  // The user this login has already checked for, so the check runs once per login.
  const checkedUserRef = useRef<SbUserId>(undefined)

  useEffect(() => {
    if (userId === undefined) {
      checkedUserRef.current = undefined
      return undefined
    }
    if (
      checkedUserRef.current === userId ||
      syncedUserId !== userId ||
      sharing !== 'notAsked' ||
      gameDefaultsPending ||
      gameDefaultsOpen
    ) {
      return undefined
    }

    checkedUserRef.current = userId
    let canceled = false
    ipcRenderer.invoke('discordCanShowActivity')?.then(
      canShow => {
        if (canShow && !canceled) {
          dispatch(openDialog({ type: DialogType.DiscordActivityPrompt }))
        }
      },
      (err: unknown) => {
        logger.error(`Error checking whether Discord activity can show: ${getErrorStack(err)}`)
      },
    )
    return () => {
      canceled = true
    }
  }, [userId, syncedUserId, sharing, gameDefaultsPending, gameDefaultsOpen, dispatch])

  return null
}

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Intro = styled.p`
  ${bodyMedium};
  margin: 0 0 8px;
`

const SharedList = styled.ul`
  ${bodyMedium};
  margin: 0 0 16px;
  padding-left: 24px;
`

const Footnote = styled.p`
  ${bodySmall};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

/**
 * Asks whether to show the user's activity on Discord. Closing it without choosing counts as
 * declining, so the question isn't asked again.
 */
export function DiscordActivityPromptDialog({ close }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const answer = (shareDiscordActivity: 'on' | 'off') => {
    dispatch(
      mergeAccountSettings({ shareDiscordActivity }, { onSuccess: () => {}, onError: () => {} }),
    )
    close()
  }

  const buttons = [
    <TextButton
      key='decline'
      label={t('discord.activityPrompt.decline', 'No thanks')}
      onClick={() => answer('off')}
      testName='discord-activity-decline'
    />,
    <TextButton
      key='enable'
      label={t('discord.activityPrompt.enable', 'Show my activity')}
      onClick={() => answer('on')}
      testName='discord-activity-enable'
    />,
  ]

  return (
    <StyledDialog
      title={t('discord.activityPrompt.title', 'Show your activity on Discord?')}
      showCloseButton={true}
      onCancel={() => answer('off')}
      buttons={buttons}
      testName='discord-activity-prompt'>
      <Intro>
        {t(
          'discord.activityPrompt.intro',
          'ShieldBattery can show what you’re doing on the Discord account signed in to the ' +
            'Discord app on this computer:',
        )}
      </Intro>
      <SharedList>
        <li>
          {t(
            'discord.activityPrompt.sharedGame',
            'The game mode, the matchup or your race, the map, and how long the game has been going',
          )}
        </li>
        <li>
          {t(
            'discord.activityPrompt.sharedLobby',
            'The map of the lobby you’re in, with the lobby’s name and a Join button if it’s listed',
          )}
        </li>
        <li>
          {t('discord.activityPrompt.sharedReplay', 'That you’re watching a replay, and its map')}
        </li>
      </SharedList>
      <Footnote>
        {t(
          'discord.activityPrompt.footnote',
          'Nothing shows while you’re not in a lobby, a game or a replay. You can change this ' +
            'later in Settings › Connections.',
        )}
      </Footnote>
    </StyledDialog>
  )
}
