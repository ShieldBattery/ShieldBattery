import React, { useCallback, useRef, useState } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/user-info'
import { useAnchorPosition } from '../material/popover'
import { ConnectedUserProfileOverlay } from '../profile/user-profile-overlay'
import { useAppSelector } from '../redux-hooks'

const Username = styled.span`
  &:hover {
    cursor: pointer;
    text-decoration: underline;
  }
`

/**
 * A component which displays the username in messaging-related services (e.g. chat, lobbies,
 * whispers) and any additional functionality that we might want to do with them, like opening a
 * user profile when clicked.
 *
 * This component is connected to the store where it tries to find the user. All the services using
 * it should ensure that the user is loaded in the store properly.
 */
export function ConnectedUsername(props: { userId: SbUserId; isMention?: boolean }) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const usernameRef = useRef(null)
  const [, anchorX, anchorY] = useAnchorPosition('right', 'top', usernameRef.current ?? null)

  const onOpenOverlay = useCallback(() => {
    setOverlayOpen(true)
  }, [])
  const onCloseOverlay = useCallback(() => {
    setOverlayOpen(false)
  }, [])

  const user = useAppSelector(s => s.users.byId.get(props.userId))
  if (!user) {
    return <span>[Unknown user]</span>
  }

  return (
    <>
      <ConnectedUserProfileOverlay
        key={'overlay'}
        userId={user.id}
        popoverProps={{
          open: overlayOpen,
          onDismiss: onCloseOverlay,
          anchorX: (anchorX ?? 0) + 4,
          anchorY: anchorY ?? 0,
          originX: 'left',
          originY: 'top',
        }}
      />
      <Username ref={usernameRef} onClick={onOpenOverlay}>
        {props.isMention ? `@${user.name}` : user.name}
      </Username>
    </>
  )
}
