import React from 'react'
import styled from 'styled-components'
import { TimestampMessageLayout } from '../messaging/message-layout'
import { blue100, blue200 } from '../styles/colors'
import { body2 } from '../styles/typography'
import {
  BanLobbyPlayerMessageRecord,
  JoinLobbyMessageRecord,
  KickLobbyPlayerMessageRecord,
  LeaveLobbyMessageRecord,
  LobbyCountdownCanceledMessageRecord,
  LobbyCountdownStartedMessageRecord,
  LobbyCountdownTickMessageRecord,
  LobbyHostChangeMessageRecord,
  LobbyLoadingCanceledMessageRecord,
  LobbyMessage,
  SelfJoinLobbyMessageRecord,
} from './lobby-message-records'

const ChatSystemMessage = styled(TimestampMessageLayout)`
  color: ${blue200};
`

const ChatImportant = styled.span`
  ${body2};
  line-height: inherit;
  color: ${blue100};
`

interface LobbyMessageProps {
  record: LobbyMessage
}

export function JoinLobbyMessage(props: LobbyMessageProps) {
  const { time, name } = props.record as JoinLobbyMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>
        &gt;&gt; <ChatImportant>{name}</ChatImportant> has joined the lobby
      </span>
    </ChatSystemMessage>
  )
}

export function LeaveLobbyMessage(props: LobbyMessageProps) {
  const { time, name } = props.record as LeaveLobbyMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>
        &lt;&lt; <ChatImportant>{name}</ChatImportant> has left the lobby
      </span>
    </ChatSystemMessage>
  )
}

export function KickLobbyPlayerMessage(props: LobbyMessageProps) {
  const { time, name } = props.record as KickLobbyPlayerMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>
        &lt;&lt; <ChatImportant>{name}</ChatImportant> has been kicked from the lobby
      </span>
    </ChatSystemMessage>
  )
}

export function BanLobbyPlayerMessage(props: LobbyMessageProps) {
  const { time, name } = props.record as BanLobbyPlayerMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>
        &lt;&lt; <ChatImportant>{name}</ChatImportant> has been banned from the lobby
      </span>
    </ChatSystemMessage>
  )
}

export function SelfJoinLobbyMessage(props: LobbyMessageProps) {
  const { time, lobby, host } = props.record as SelfJoinLobbyMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>
        You have joined <ChatImportant>{lobby}</ChatImportant>. The host is{' '}
        <ChatImportant>{host}</ChatImportant>.
      </span>
    </ChatSystemMessage>
  )
}

export function LobbyHostChangeMessage(props: LobbyMessageProps) {
  const { time, name } = props.record as LobbyHostChangeMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>
        <ChatImportant>{name}</ChatImportant> is now the host
      </span>
    </ChatSystemMessage>
  )
}

export function LobbyCountdownStartedMessage(props: LobbyMessageProps) {
  const { time } = props.record as LobbyCountdownStartedMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>The game countdown has begun</span>
    </ChatSystemMessage>
  )
}

export function LobbyCountdownTickMessage(props: LobbyMessageProps) {
  const { time, timeLeft } = props.record as LobbyCountdownTickMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>{timeLeft}&hellip;</span>
    </ChatSystemMessage>
  )
}

export function LobbyCountdownCanceledMessage(props: LobbyMessageProps) {
  const { time } = props.record as LobbyCountdownCanceledMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>The game countdown has been canceled</span>
    </ChatSystemMessage>
  )
}

export function LobbyLoadingCanceledMessage(props: LobbyMessageProps) {
  // TODO(tec27): We really need to pass a reason back here
  const { time } = props.record as LobbyLoadingCanceledMessageRecord
  return (
    <ChatSystemMessage time={time}>
      <span>Game initialization has been canceled</span>
    </ChatSystemMessage>
  )
}
