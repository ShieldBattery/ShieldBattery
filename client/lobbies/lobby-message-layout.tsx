import React from 'react'
import styled from 'styled-components'
import { TimestampMessageLayout } from '../messaging/message-layout'
import { blue100, blue200 } from '../styles/colors'
import { body2 } from '../styles/typography'

const ChatSystemMessage = styled(TimestampMessageLayout)`
  color: ${blue200};
`

const Important = styled.span`
  ${body2};
  line-height: inherit;
  color: ${blue100};
`

export const JoinLobbyMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <ChatSystemMessage time={time}>
      <span>
        &gt;&gt; <Important>{name}</Important> has joined the lobby
      </span>
    </ChatSystemMessage>
  )
})

export const LeaveLobbyMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <ChatSystemMessage time={time}>
      <span>
        &lt;&lt; <Important>{name}</Important> has left the lobby
      </span>
    </ChatSystemMessage>
  )
})

export const KickLobbyPlayerMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <ChatSystemMessage time={time}>
      <span>
        &lt;&lt; <Important>{name}</Important> has been kicked from the lobby
      </span>
    </ChatSystemMessage>
  )
})

export const BanLobbyPlayerMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <ChatSystemMessage time={time}>
      <span>
        &lt;&lt; <Important>{name}</Important> has been banned from the lobby
      </span>
    </ChatSystemMessage>
  )
})

export const SelfJoinLobbyMessage = React.memo<{ time: number; lobby: string; host: string }>(
  props => {
    const { time, lobby, host } = props
    return (
      <ChatSystemMessage time={time}>
        <span>
          You have joined <Important>{lobby}</Important>. The host is <Important>{host}</Important>.
        </span>
      </ChatSystemMessage>
    )
  },
)

export const LobbyHostChangeMessage = React.memo<{ time: number; name: string }>(props => {
  const { time, name } = props
  return (
    <ChatSystemMessage time={time}>
      <span>
        <Important>{name}</Important> is now the host
      </span>
    </ChatSystemMessage>
  )
})

export const LobbyCountdownStartedMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  return (
    <ChatSystemMessage time={time}>
      <span>The game countdown has begun</span>
    </ChatSystemMessage>
  )
})

export const LobbyCountdownTickMessage = React.memo<{ time: number; timeLeft: number }>(props => {
  const { time, timeLeft } = props
  return (
    <ChatSystemMessage time={time}>
      <span>{timeLeft}&hellip;</span>
    </ChatSystemMessage>
  )
})

export const LobbyCountdownCanceledMessage = React.memo<{ time: number }>(props => {
  const { time } = props
  return (
    <ChatSystemMessage time={time}>
      <span>The game countdown has been canceled</span>
    </ChatSystemMessage>
  )
})

export const LobbyLoadingCanceledMessage = React.memo<{ time: number }>(props => {
  // TODO(tec27): We really need to pass a reason back here
  const { time } = props
  return (
    <ChatSystemMessage time={time}>
      <span>Game initialization has been canceled</span>
    </ChatSystemMessage>
  )
})
