import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { SbUserId } from '../../common/users/sb-user'
import { TransInterpolation } from '../i18n/i18next'
import { useChatUserMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'

export const JoinLobbyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.joinLobby'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has joined the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LeaveLobbyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.leaveLobby'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has left the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const KickLobbyPlayerMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.kickPlayer'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has been kicked from the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const BanLobbyPlayerMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.banPlayer'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has been banned from the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const SelfJoinLobbyMessage = React.memo<{ time: number; lobby: string; hostId: SbUserId }>(
  props => {
    const { time, lobby, hostId } = props
    const { t } = useTranslation()
    const filterClick = useMentionFilterClick()
    const addChatMenuItems = useChatUserMenuItems()
    return (
      <SystemMessage time={time}>
        <span>
          <Trans t={t} i18nKey='lobbies.messageLayout.selfJoin'>
            You have joined <SystemImportant>{{ lobby } as TransInterpolation}</SystemImportant>.
            The host is{' '}
            <SystemImportant>
              <ConnectedUsername
                userId={hostId}
                filterClick={filterClick}
                modifyMenuItems={addChatMenuItems}
              />
            </SystemImportant>
            .
          </Trans>
        </span>
      </SystemMessage>
    )
  },
)

export const LobbyHostChangeMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='lobbies.messageLayout.hostChange'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          is now the host
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LobbyCountdownStartedMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('lobbies.messageLayout.countdownStarted', 'The game countdown has begun')}</span>
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
      <span>
        {t('lobbies.messageLayout.countdownCanceled', 'The game countdown has been canceled')}
      </span>
    </SystemMessage>
  )
})

export const LobbyLoadingCanceledMessage = React.memo<{ time: number }>(props => {
  // TODO(tec27): We really need to pass a reason back here
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        {t(
          'lobbies.messageLayout.gameInitializationCanceled',
          'Game initialization has been canceled',
        )}
      </span>
    </SystemMessage>
  )
})
