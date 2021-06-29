import React from 'react'
import { ConnectedUsername } from '../messaging/connected-username'
import {
  InfoImportant,
  SeparatedInfoMessage,
  SystemImportant,
  SystemMessage,
} from '../messaging/message-layout'

export const JoinChannelMessage = React.memo<{ time: number; userId: number }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has joined the channel
      </span>
    </SystemMessage>
  )
})

export const LeaveChannelMessage = React.memo<{ time: number; userId: number }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has left the channel
      </span>
    </SystemMessage>
  )
})

export const NewChannelOwnerMessage = React.memo<{ time: number; newOwnerId: number }>(props => {
  const { time, newOwnerId } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={newOwnerId} />
        </SystemImportant>{' '}
        is the new owner of the channel
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
