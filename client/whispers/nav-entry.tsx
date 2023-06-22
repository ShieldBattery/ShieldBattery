import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`

interface WhisperNavEntryProps {
  userId: SbUserId
  username?: string
  currentPath: string
  onClose: (userId: SbUserId) => void
  hasUnread?: boolean
}

export function WhisperNavEntry({
  userId,
  username,
  currentPath,
  onClose,
  hasUnread = false,
}: WhisperNavEntryProps) {
  const { t } = useTranslation()
  const button = (
    <LeaveButton
      icon={<MaterialIcon icon='close' />}
      title={t('whispers.navEntry.closeWhisper', 'Close whisper')}
      onClick={() => onClose(userId)}
    />
  )

  // TODO(tec27): Show scaffold if user isn't loaded currently?
  return (
    <Entry
      link={urlPath`/whispers/${userId}/${username ?? ''}`}
      currentPath={currentPath}
      button={button}
      needsAttention={hasUnread}>
      {username}
    </Entry>
  )
}
