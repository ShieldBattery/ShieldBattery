import React from 'react'
import { SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user'
import { useChatUserMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import {
  InfoImportant,
  SeparatedInfoMessage,
  SystemImportant,
  SystemMessage,
} from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'
import { ConnectedChannelName } from './connected-channel-name'
import { useTranslation } from 'react-i18next'

export const JoinChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('chat.userHasJoinedChannel', 'has joined the channel')}
      </span>
    </SystemMessage>
  )
})

export const LeaveChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('chat.userHasLeftChannel', 'has left the channel')}
      </span>
    </SystemMessage>
  )
})

export const KickUserMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        {t('chat.userKickedFromChannel', 'has been kicked from the channel')}
      </span>
    </SystemMessage>
  )
})

export const BanUserMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        {t('chat.userBannedFromChannel', 'has been banned from the channel')}
      </span>
    </SystemMessage>
  )
})

export const NewChannelOwnerMessage = React.memo<{ time: number; newOwnerId: SbUserId }>(props => {
  const { time, newOwnerId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={newOwnerId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        {t('chat.newChannelOwner', 'is the new owner of the channel')}
      </span>
    </SystemMessage>
  )
})

export const SelfJoinChannelMessage = React.memo<{ channelId: SbChannelId }>(props => {
  const { channelId } = props
  const { t } = useTranslation()
  return (
    <SeparatedInfoMessage>
      <span>
      {t('chat.youJoined', 'You joined')}{' '}
        <InfoImportant>
          <ConnectedChannelName channelId={channelId} />
        </InfoImportant>
      </span>
    </SeparatedInfoMessage>
  )
})
