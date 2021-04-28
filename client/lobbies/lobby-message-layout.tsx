import React from 'react'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'

export const JoinLobbyMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt; <SystemImportant>{name}</SystemImportant> has joined the lobby
      </span>
    </SystemMessage>
  )
})

export const LeaveLobbyMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt; <SystemImportant>{name}</SystemImportant> has left the lobby
      </span>
    </SystemMessage>
  )
})

export const KickLobbyPlayerMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt; <SystemImportant>{name}</SystemImportant> has been kicked from the lobby
      </span>
    </SystemMessage>
  )
})

export const BanLobbyPlayerMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt; <SystemImportant>{name}</SystemImportant> has been banned from the lobby
      </span>
    </SystemMessage>
  )
})

export const SelfJoinLobbyMessage = React.memo<{ time: number; lobby: string; host: string }>(
  props => {
    const { time, lobby, host } = props
    return (
      <SystemMessage time={time}>
        <span>
          You have joined <SystemImportant>{lobby}</SystemImportant>. The host is{' '}
          <SystemImportant>{host}</SystemImportant>.
        </span>
      </SystemMessage>
    )
  },
)

export const LobbyHostChangeMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{name}</SystemImportant> is now the host
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
