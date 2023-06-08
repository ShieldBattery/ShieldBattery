import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags'
import { urlPath } from '../../common/urls'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'
import { useStableCallback } from '../state-hooks'

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
  const { t } = useTranslation()
  const onLeaveClick = useStableCallback(() => {
    onLeave(channelId)
  })

  const button = (
    <LeaveButton
      icon={<MaterialIcon icon='close' />}
      title={t('chat.navEntry.leaveChannel', 'Leave channel')}
      onClick={onLeaveClick}
    />
  )

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
