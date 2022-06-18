import React from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { useMentionFilterClick } from '../messaging/mention-hooks'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'

export const JoinLobbyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} filterClick={filterClick} />
        </SystemImportant>{' '}
        has joined the lobby
      </span>
    </SystemMessage>
  )
})

export const LeaveLobbyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} filterClick={filterClick} />
        </SystemImportant>{' '}
        has left the lobby
      </span>
    </SystemMessage>
  )
})

export const KickLobbyPlayerMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} filterClick={filterClick} />
        </SystemImportant>{' '}
        has been kicked from the lobby
      </span>
    </SystemMessage>
  )
})

export const BanLobbyPlayerMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} filterClick={filterClick} />
        </SystemImportant>{' '}
        has been banned from the lobby
      </span>
    </SystemMessage>
  )
})

export const SelfJoinLobbyMessage = React.memo<{ time: number; lobby: string; hostId: SbUserId }>(
  props => {
    const { time, lobby, hostId } = props
    const filterClick = useMentionFilterClick()
    return (
      <SystemMessage time={time}>
        <span>
          You have joined <SystemImportant>{lobby}</SystemImportant>. The host is{' '}
          <SystemImportant>
            <ConnectedUsername userId={hostId} filterClick={filterClick} />
          </SystemImportant>
          .
        </span>
      </SystemMessage>
    )
  },
)

export const LobbyHostChangeMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} filterClick={filterClick} />
        </SystemImportant>{' '}
        is now the host
      </span>
    </SystemMessage>
  )
})

export const LobbyCountdownStartedMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  return (
    <SystemMessage time={time}>
      <span>The game countdown has begun</span>
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
  return (
    <SystemMessage time={time}>
      <span>The game countdown has been canceled</span>
    </SystemMessage>
  )
})

export const LobbyLoadingCanceledMessage = React.memo<{ time: number }>(props => {
  // TODO(tec27): We really need to pass a reason back here
  const { time } = props
  return (
    <SystemMessage time={time}>
      <span>Game initialization has been canceled</span>
    </SystemMessage>
  )
})
