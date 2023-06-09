import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
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

export const JoinChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='chat.messageLayout.joinChannel'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has joined the channel
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LeaveChannelMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='chat.messageLayout.leaveChannel'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has left the channel
        </Trans>
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
        <Trans t={t} i18nKey='chat.messageLayout.kickUser'>
          <SystemImportant>
            <ConnectedUsername userId={userId} />
          </SystemImportant>{' '}
          has been kicked from the channel
        </Trans>
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
        <Trans t={t} i18nKey='chat.messageLayout.banUser'>
          <SystemImportant>
            <ConnectedUsername userId={userId} />
          </SystemImportant>{' '}
          has been banned from the channel
        </Trans>
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
        <Trans t={t} i18nKey='chat.messageLayout.newChannelOwner'>
          <SystemImportant>
            <ConnectedUsername
              userId={newOwnerId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          is the new owner of the channel
        </Trans>
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
        <Trans t={t} i18nKey='chat.messageLayout.selfJoinChannel'>
          You joined{' '}
          <InfoImportant>
            <ConnectedChannelName channelId={channelId} />
          </InfoImportant>
        </Trans>
      </span>
    </SeparatedInfoMessage>
  )
})
