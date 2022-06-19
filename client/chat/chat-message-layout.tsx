import React from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { useMentionFilterClick, useMentionMenuItem } from '../messaging/mention-hooks'
import {
  InfoImportant,
  SeparatedInfoMessage,
  SystemImportant,
  SystemMessage,
} from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'

export const JoinChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addMentionMenuItem = useMentionMenuItem()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addMentionMenuItem}
          />
        </SystemImportant>{' '}
        has joined the channel
      </span>
    </SystemMessage>
  )
})

export const LeaveChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addMentionMenuItem = useMentionMenuItem()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addMentionMenuItem}
          />
        </SystemImportant>{' '}
        has left the channel
      </span>
    </SystemMessage>
  )
})

export const KickUserMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has been kicked from the channel
      </span>
    </SystemMessage>
  )
})

export const BanUserMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has been banned from the channel
      </span>
    </SystemMessage>
  )
})

export const NewChannelOwnerMessage = React.memo<{ time: number; newOwnerId: SbUserId }>(props => {
  const { time, newOwnerId } = props
  const filterClick = useMentionFilterClick()
  const addMentionMenuItem = useMentionMenuItem()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={newOwnerId}
            filterClick={filterClick}
            modifyMenuItems={addMentionMenuItem}
          />
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
