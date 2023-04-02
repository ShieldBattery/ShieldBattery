import React from 'react'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags'
import { urlPath } from '../../common/urls'
import CloseIcon from '../icons/material/close-24px.svg'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'
import { useStableCallback } from '../state-hooks'
import { useTranslation } from 'react-i18next'

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`

interface ChatNavEntryProps {
  channelId: SbChannelId
  channelName: string
  currentPath: string
  hasUnread: boolean
  onLeave: (channelId: SbChannelId) => void
}

export function ChatNavEntry({
  channelId,
  channelName,
  currentPath,
  hasUnread,
  onLeave,
}: ChatNavEntryProps) {
  const onLeaveClick = useStableCallback(() => {
    onLeave(channelId)
  })
  const { t } = useTranslation()
  const button = <LeaveButton icon={<CloseIcon />} title={t('chat.navEntry.leaveChannelHeader', 'Leave channel')} onClick={onLeaveClick} />

  return (
    <Entry
      link={urlPath`/chat/${channelId}/${channelName}`}
      currentPath={currentPath}
      needsAttention={hasUnread}
      button={channelId !== 1 || CAN_LEAVE_SHIELDBATTERY_CHANNEL ? button : null}>
      #{channelName}
    </Entry>
  )
}
