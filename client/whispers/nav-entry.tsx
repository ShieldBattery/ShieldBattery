import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useLocation } from 'wouter'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { Entry } from '../material/left-nav/entry'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { getBatchUserInfo } from '../users/action-creators'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'

export function ConnectedWhisperNavEntry({
  userId,
  onClose,
}: {
  userId: SbUserId
  onClose: (userId: SbUserId) => void
}) {
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const hasUnread = useAppSelector(s => s.whispers.byId.get(userId)?.hasUnread ?? false)
  const isBlocked = useAppSelector(s => s.relationships.blocks.has(userId))
  const [pathname] = useLocation()

  const { isOverlayOpen, contextMenuProps, onContextMenu } = useUserOverlays<HTMLSpanElement>({
    userId,
  })

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  return isBlocked ? null : (
    <>
      <ConnectedUserContextMenu {...contextMenuProps} />

      <WhisperNavEntry
        userId={userId}
        username={username}
        currentPath={pathname}
        hasUnread={hasUnread}
        isOverlayOpen={isOverlayOpen}
        onClose={onClose}
        onContextMenu={onContextMenu}
      />
    </>
  )
}

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`

const LoadingName = styled.span`
  margin-right: 0.25em;
  background-color: var(--theme-skeleton);
  border-radius: 2px;
`

interface WhisperNavEntryProps {
  userId: SbUserId
  username?: string
  currentPath: string
  isOverlayOpen: boolean
  hasUnread?: boolean
  onClose: (userId: SbUserId) => void
  onContextMenu: (event: React.MouseEvent) => void
}

function WhisperNavEntry({
  userId,
  username,
  currentPath,
  isOverlayOpen,
  hasUnread = false,
  onClose,
  onContextMenu,
}: WhisperNavEntryProps) {
  const { t } = useTranslation()
  const button = (
    <LeaveButton
      icon={<MaterialIcon icon='close' />}
      title={t('whispers.navEntry.closeWhisper', 'Close whisper')}
      onClick={() => onClose(userId)}
    />
  )

  const usernameElem = username ?? (
    <LoadingName aria-label={'Username loading…'}>
      &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
    </LoadingName>
  )

  return (
    <Entry
      link={urlPath`/whispers/${userId}/${username ?? ''}`}
      currentPath={currentPath}
      button={button}
      needsAttention={hasUnread}
      isActive={isOverlayOpen}
      onContextMenu={onContextMenu}>
      {usernameElem}
    </Entry>
  )
}
