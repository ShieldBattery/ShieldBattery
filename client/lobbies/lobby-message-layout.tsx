import React from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { useChatUserMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'
import { Trans, useTranslation } from 'react-i18next'

export const JoinLobbyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('lobbies.lobbyMessageLayout.playerJoinedLobby', 'has joined the lobby')}
      </span>
    </SystemMessage>
  )
})

export const LeaveLobbyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('lobbies.lobbyMessageLayout.playerLeftLobby', 'has left the lobby')}
      </span>
    </SystemMessage>
  )
})

export const KickLobbyPlayerMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('lobbies.lobbyMessageLayout.playerKicked', 'has been kicked from the lobby')}
      </span>
    </SystemMessage>
  )
})

export const BanLobbyPlayerMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('lobbies.lobbyMessageLayout.playerBanned', 'has been banned from the lobby')}
      </span>
    </SystemMessage>
  )
})

export const SelfJoinLobbyMessage = React.memo<{ time: number; lobby: string; hostId: SbUserId }>(
  props => {
    const { time, lobby, hostId } = props
    const filterClick = useMentionFilterClick()
    const addChatMenuItems = useChatUserMenuItems()
    return (
      <SystemMessage time={time}>
        <Trans i18nKey="lobbies.lobbyMessageLayout.lobbyJoined">
        <span>
          You have joined <SystemImportant>{lobby}</SystemImportant>. The host is{' '}
          <SystemImportant>
            <ConnectedUsername
              userId={hostId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>
          .
        </span>
        </Trans>
      </SystemMessage>
    )
  },
)

export const LobbyHostChangeMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <Trans i18nKey="lobbies.lobbyMessageLayout.hostChange">
        <span>
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        is now the host
      </span>
      </Trans>
    </SystemMessage>
  )
})

export const LobbyCountdownStartedMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('lobbies.lobbyMessageLayout.gameCountdownStarted', 'The game countdown has begun')}</span>
    </SystemMessage>
  )
})

export const LobbyCountdownTickMessage = React.memo<{ time: number; timeLeft: number }>(props => {
  const { time, timeLeft } = props
  return (
    <SystemMessage time={time}>
      <span>{timeLeft}&hellip;</span>
    </SystemMessage>
  )
})

export const LobbyCountdownCanceledMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('lobbies.lobbyMessageLayout.gameCountdownCanceled', 'The game countdown has been canceled')}</span>
    </SystemMessage>
  )
})

export const LobbyLoadingCanceledMessage = React.memo<{ time: number }>(props => {
  // TODO(tec27): We really need to pass a reason back here
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('lobbies.lobbyMessageLayout.gameInitializationCanceled', 'Game initialization has been canceled')}</span>
    </SystemMessage>
  )
})
