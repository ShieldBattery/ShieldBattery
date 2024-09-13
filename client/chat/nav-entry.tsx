import React from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { SbChannelId } from '../../common/chat.js'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags.js'
import { urlPath } from '../../common/urls.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { IconButton } from '../material/button.js'
import { Entry } from '../material/left-nav/entry.js'
import { useStableCallback } from '../state-hooks.js'

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
