import React from 'react'
import {
  InfoImportant,
  SeparatedInfoMessage,
  SystemImportant,
  SystemMessage,
} from '../messaging/message-layout'

export const JoinChannelMessage = React.memo<{ time: number; user: string }>(props => {
  const { time, user } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{user}</SystemImportant> has joined the channel
      </span>
    </SystemMessage>
  )
})

export const LeaveChannelMessage = React.memo<{ time: number; user: string }>(props => {
  const { time, user } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{user}</SystemImportant> has left the channel
      </span>
    </SystemMessage>
  )
})

export const NewChannelOwnerMessage = React.memo<{ time: number; newOwner: string }>(props => {
  const { time, newOwner } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>{newOwner}</SystemImportant> is the new owner of the channel
      </span>
    </SystemMessage>
  )
})

export const SelfJoinChannelMessage = React.memo<{ channel: string }>(props => {
  const { channel } = props
  return (
    <SeparatedInfoMessage>
      <span>
        You joined <InfoImportant>#{channel}</InfoImportant>
      </span>
    </SeparatedInfoMessage>
  )
})
