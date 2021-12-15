import React from 'react'
import { SbUserId } from '../../common/users/user-info'
import {
  InfoImportant,
  SeparatedInfoMessage,
  SystemImportant,
  SystemMessage,
} from '../messaging/message-layout'
import { ConnectedUsername } from '../profile/connected-username'

export const JoinChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
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

export const LeaveChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
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

export const NewChannelOwnerMessage = React.memo<{ time: number; newOwnerId: SbUserId }>(props => {
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
