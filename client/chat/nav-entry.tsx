import React from 'react'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import CloseIcon from '../icons/material/close-24px.svg'
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
  const onLeaveClick = useStableCallback(() => {
    onLeave(channelId)
  })

  const button = <LeaveButton icon={<CloseIcon />} title='Leave channel' onClick={onLeaveClick} />

  return (
    <Entry
      link={`/chat/${channelId}/${encodeURIComponent(channelName)}`}
      currentPath={currentPath}
      needsAttention={hasUnread}
      button={channelId !== 1 ? button : null}>
      #{channelName}
    </Entry>
  )
}
